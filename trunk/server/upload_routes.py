#! /usr/bin/python
# coding: utf-8

#upload script
#   parses OSM XML data from stdout and loads it to the database
#author: gryphon
#license: WTFPL v.2
#$Revision$
#$Date$

import sys;
from lxml import etree;
import psycopg2;
from threading import Timer;
from datetime import datetime;

#flXml="./bus.osm";

class PostGisWriter:
    __bufSize=100000;
    __buf=None;
    def __init__(self,dbname,host=None,user=None,password=None):
        strConnParams="dbname="+dbname;
        if not host is None: 
            strConnParams+=" host="+host;
        if not user is None: 
            strConnParams+=" user="+user;
        if not password is None: 
            strConnParams+=" password="+password;
        self.conn=psycopg2.connect(strConnParams);
        self.cursor=self.conn.cursor();
        self.__createTmpTables();
        self.__initBuf();
    def __del__(self):
        self.conn.commit();
        self.cursor.close();
        self.conn.close();
    def __createTmpTables(self):
        print("creating temp tables");
        self.cursor.execute("DROP TABLE IF EXISTS "
                                "tmp_nodes, "
                                "tmp_waysnd, "
                                "tmp_routes, "
                                "tmp_routesways, "
                                "tmp_routesnodes;");
        self.cursor.execute("CREATE TABLE tmp_nodes (osm_id BIGINT PRIMARY KEY,"
                                                     "name TEXT,"
                                                     "shelter TEXT,"
                                                     "point geometry(POINT,4326) );");
        self.cursor.execute("CREATE TABLE tmp_waysnd ("
                                "id BIGSERIAL PRIMARY KEY,"
                                "osm_id BIGINT NOT NULL,"
                                "nd_id BIGINT NOT NULL);");
        self.cursor.execute("CREATE INDEX tmp_waysnd_osm_id_index ON tmp_waysnd(osm_id);");
        self.cursor.execute("CREATE INDEX tmp_waysnd_nd_id_index ON tmp_waysnd(nd_id);");
        self.cursor.execute("CREATE TABLE tmp_routes (osm_id BIGINT PRIMARY KEY,"
                                                     "name TEXT,"
                                                     "ref TEXT,"
                                                     "operator TEXT,"
                                                     "\"from\" TEXT,"
                                                     "\"to\" TEXT,"
                                                     "route TEXT,"
                                                     "color TEXT"
                                                     " );");
        self.cursor.execute("CREATE TABLE tmp_routesways ("
                                "id BIGSERIAL PRIMARY KEY,"
                                "route_id BIGINT NOT NULL,"
                                "way_id BIGINT NOT NULL );");
        self.cursor.execute("CREATE INDEX tmp_routesways_route_id_index ON tmp_routesways(route_id);");
        self.cursor.execute("CREATE INDEX tmp_routesways_way_id_index ON tmp_routesways(way_id);");
        self.cursor.execute("CREATE TABLE tmp_routesnodes ("
                                "id BIGSERIAL PRIMARY KEY,"
                                "route_id BIGINT NOT NULL, "
                                "node_id BIGINT NOT NULL);");
        self.cursor.execute("CREATE INDEX tmp_routesnodes_route_id_index ON tmp_routesnodes(route_id);");
        self.cursor.execute("CREATE INDEX tmp_routesnodes_node_id_index ON tmp_routesnodes(node_id);");
    def createResultTables(self):
        self.flushBuffer();
        print("creating result tables");
        sql='''
        -- create empty tables

        DROP TABLE IF EXISTS routes,busstops,routes2busstops;
        CREATE TABLE routes (
            osm_id BIGINT PRIMARY KEY,
            name TEXT,
            ref TEXT,
            operator TEXT,
            "from" TEXT,
            "to" TEXT,
            route TEXT,
            color TEXT,
            lines geometry(MULTILINESTRING,4326)
        );
        CREATE INDEX routes_lines_index ON routes USING GIST (lines);
        CREATE TABLE busstops (
            osm_id BIGINT PRIMARY KEY,
            point geometry(POINT,4326),
            name TEXT,
            shelter TEXT 
        );
        CREATE TABLE routes2busstops (
            id BIGSERIAL,
            route_id BIGINT REFERENCES routes (osm_id),
            busstop_id BIGINT REFERENCES busstops (osm_id)
        );
        CREATE INDEX r2b_rid_index ON routes2busstops (route_id);
        CREATE INDEX r2b_bid_index ON routes2busstops (busstop_id);

        -- select nodes and ways from the routes

        SELECT rw.id, rw.way_id,rw.route_id 
        INTO TEMP tt_routesways
        FROM tmp_routes r JOIN tmp_routesways rw
            ON (r.osm_id=rw.route_id)
        ORDER BY rw.id;

        CREATE INDEX tt_routesways_id_index ON tt_routesways(id);
        CREATE INDEX tt_routesways_route_id_index ON tt_routesways(route_id);

        SELECT rn.id, rn.node_id,rn.route_id 
        INTO TEMP tt_routesnodes
        FROM tmp_routes r JOIN tmp_routesnodes rn
            ON (r.osm_id=rn.route_id)
        ORDER BY rn.id;

        CREATE INDEX tt_routesnodes_id_index ON tt_routesnodes(id);
        CREATE INDEX tt_routesnodes_route_id_index ON tt_routesnodes(route_id);

        SELECT w.id, w.osm_id, w.nd_id 
        INTO TEMP tt_waysnds
        FROM tmp_waysnd w JOIN tt_routesways rw
            ON (w.osm_id=rw.way_id)
        ORDER BY w.id;

        CREATE INDEX tt_waysnds_id_index ON tt_waysnds(id);
        CREATE INDEX tt_waysnds_osm_id_index ON tt_waysnds(osm_id);

        -- Delete broken objects

        DELETE FROM tt_waysnds
        WHERE osm_id IN (
            SELECT DISTINCT w.osm_id  
            FROM tt_waysnds w LEFT OUTER JOIN tmp_nodes n 
                ON (w.nd_id=n.osm_id)
            WHERE n.osm_id IS NULL) 
        ;

        DELETE FROM tt_routesways
        WHERE route_id IN (
            SELECT DISTINCT route_id 
            FROM tt_routesways rw LEFT OUTER JOIN tt_waysnds w
                ON (rw.way_id=w.osm_id)
            WHERE w.osm_id IS NULL) 
        ;

        DELETE FROM tt_routesnodes
        WHERE route_id IN (
            SELECT DISTINCT route_id 
            FROM tt_routesnodes rn LEFT OUTER JOIN tmp_nodes n
                ON (rn.node_id=n.osm_id)
            WHERE n.osm_id IS NULL) 
        ;

        DELETE FROM tmp_routes 
        WHERE osm_id NOT IN (
            SELECT DISTINCT route_id 
            FROM tt_routesways) 
        ;

        -- Union geometry

        SELECT wnp.osm_id as way_id, ST_MakeLine(point) as line
        INTO TEMP tt_ways
        --FROM tt_waysnds w JOIN tmp_nodes n
        --	ON (w.nd_id=n.osm_id)
        FROM (select w.id,w.osm_id,n.point from tt_waysnds w JOIN tmp_nodes n
            ON (w.nd_id=n.osm_id)
            ORDER BY w.id
             ) as wnp
        GROUP BY way_id
        ;

        CREATE INDEX tt_ways_way_id_index ON tt_ways(way_id);

        SELECT route_id, 
               ST_Simplify(ST_Multi(ST_LineMerge(ST_Collect(line))),0.00005) mline
        INTO TEMP tt_routesgeom
        FROM (SELECT route_id, line 
            FROM tt_routesways rw JOIN tt_ways w
            ON (rw.way_id=w.way_id)
            ORDER BY rw.id
            ) as rwl
        GROUP BY route_id
        ;

        CREATE INDEX tt_routesgeom_route_id ON tt_routesgeom (route_id);

        -- write the result into permanent tables

        DELETE FROM routes2busstops;
        DELETE FROM busstops;
        DELETE FROM routes;

        INSERT INTO routes (
            SELECT osm_id,name,ref,operator,"from","to",route,color,mline 
            FROM tmp_routes r JOIN tt_routesgeom rg
                ON (r.osm_id=rg.route_id)
        );

        INSERT INTO busstops (
            SELECT osm_id,point,name,shelter
                FROM 	tmp_nodes n JOIN 
                (SELECT DISTINCT node_id 
                FROM tt_routesnodes) as rn
                ON (n.osm_id=rn.node_id)
            )
        ;

        INSERT INTO routes2busstops (
            SELECT id,route_id,node_id
            FROM tmp_routesnodes rn JOIN routes r
                ON (rn.route_id=r.osm_id)
                JOIN busstops b
                ON (b.osm_id=rn.node_id)
            )
        ;

        '''
        self.cursor.execute(sql);
        print ("created");
        self.cursor.execute("DROP TABLE IF EXISTS "
                                "tmp_nodes, "
                                "tmp_waysnd, "
                                "tmp_routes, "
                                "tmp_routesways, "
                                "tmp_routesnodes;");
        self.conn.commit();
        return;
    def __initBuf(self):
        self.__buf=dict(routes=dict(),nodes=dict(),waysNds=dict(),routesNodes=dict(),routesWays=dict());
        buf=self.__buf;
        for elem in buf:
            buf[elem]["data"]=[];
        buf["routes"]["sql"]="INSERT INTO tmp_routes VALUES";
        buf["nodes"]["sql"]="INSERT INTO tmp_nodes VALUES";
        buf["waysNds"]["sql"]="INSERT INTO tmp_waysnd (osm_id, nd_id) VALUES";
        buf["routesNodes"]["sql"]="INSERT INTO tmp_routesnodes (route_id, node_id) VALUES";
        buf["routesWays"]["sql"]="INSERT INTO tmp_routesways (route_id, way_id) VALUES";

    def __writeData(self,dBuf):
        if len(dBuf)==0:
            return
        strVals= ','.join(dBuf["data"])
        self.cursor.execute(dBuf["sql"]+strVals+";");
        dBuf["data"]=[];

    def flushBuffer(self):
        for key in self.__buf:
            self.__writeData(self.__buf[key]);

    def __appendData(self,dBuf,data):
        dBuf["data"].append(data);
        if len(dBuf["data"])>self.__bufSize:
            self.__writeData(dBuf);

    def appendRoute(self,attribs,tags):
        data=(attribs["id"],);
        for key in ["name","ref","operator","from","to","route","color"]:
            data+=(tags[key],);
        strData=self.cursor.mogrify("(%s,%s,%s,%s,%s,%s,%s,%s)",data);
        self.__appendData(self.__buf["routes"],strData);

    def appendNode(self,attribs,tags):
        geomStr="POINT("+attribs["lon"]+" "+attribs["lat"]+")";
        data=(attribs["id"],tags["name"],tags["shelter"],geomStr);
        strData=self.cursor.mogrify("(%s,%s,%s,ST_GeomFromText(%s,4326))",data);
        self.__appendData(self.__buf["nodes"],strData);

    def appendWayNd(self,wayid,ndid):
        data=(wayid,ndid);
        strData=self.cursor.mogrify("(%s,%s)",data);
        self.__appendData(self.__buf["waysNds"],strData);

    def appendRouteNode(self,route_id,node_id):
        data=(route_id,node_id);
        strData=self.cursor.mogrify("(%s,%s)",data);
        self.__appendData(self.__buf["routesNodes"],strData);

    def appendRouteWay(self,route_id,way_id):
        data=(route_id,way_id);
        strData=self.cursor.mogrify("(%s,%s)",data);
        self.__appendData(self.__buf["routesWays"],strData);

class PgsqlTarget(PostGisWriter):
    __countNodes=0;
    __countWays=0;
    __countRels=0;
    __finished=False;
    def __printStat(self):
        print("{0}\n\tnodes: {1} \n\tways: {2}\n\trels: {3}".format(
            datetime.now(),self.__countNodes,self.__countWays,self.__countRels));
        if self.__finished:
            return
        self.__timer=Timer(60,self.__printStat,());
        self.__timer.start();
    def start(self, tag, attrib):
        if (tag=="osm"): 
            print("parsing XML");
            self.__printStat();
        if (tag=="node"): 
            self.__attribs=dict(lat=attrib["lat"],lon=attrib["lon"],id=attrib["id"]);
            self.__tags=dict(name=None,shelter=None);
        elif (tag=="tag"):
            self.__tags[attrib["k"]]=attrib["v"];
        elif (tag=="way"):
            self.__countWays+=1;
            self.__wayid=attrib["id"];
        elif (tag=="nd"):
            self.appendWayNd(self.__wayid,attrib["ref"]);
        elif (tag=="relation"):
            self.__relid=attrib["id"];
            self.__attribs=dict(id=attrib["id"]);
            self.__tags=dict();
            for key in ["name","ref","operator","from","to","route","color"]:
                self.__tags[key]=None;
        elif (tag=="member"):
            memtype=attrib["type"];
            ref=attrib["ref"];
            if memtype=="way":
                self.appendRouteWay(self.__relid,ref);
            elif memtype=="node":
                self.appendRouteNode(self.__relid,ref);
    def end(self, tag):
        if (tag=="node"):
            self.__countNodes+=1;
            self.appendNode(self.__attribs,self.__tags);
        elif (tag=="relation"):
            self.__countRels+=1;
            if self.__tags["route"]=="bus":
                self.appendRoute(self.__attribs,self.__tags);
        elif (tag=="osm"):
            self.createResultTables();
            self.__finished=True;
            self.__timer.cancel();
        return;
    def data(self, data):
        return
    def comment(self, text):
        print("comment %s" % text)
    def close(self):
        print("end of the XML");
        return "closed!"

pgsqlTarget=PgsqlTarget(dbname="testbase",host="postgis",user="testuser",password="testpassword");
parser=etree.XMLParser(target=pgsqlTarget);
#f=open(flXml,"r");
#etree.parse(f,parser);
etree.parse(sys.stdin,parser);
#f.close();
