#! /usr/bin/python
# coding: utf-8

#upload script
#   parses OSM XML data from stdout and loads it to the database
#   low disk consumption version

#author: gryphon
#license: WTFPL v.2
#$Revision$
#$Date$
#$HeadURL$

import sys;
from lxml import etree;
import psycopg2;
from threading import Timer;
from datetime import datetime;

import db_config;
import sql_queries;

#flXml="./bus.osm";

class PostGisWriter(object):
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
        self.__initBuf();
    def __del__(self):
        print("destructor");
        self.conn.commit();
        self.cursor.close();
        self.conn.close();
    def createTmpTables(self):
        print("creating temp tables");
        self.cursor.execute(sql_queries.sql_create_tmp_tables);
    def createTmpTablesNodes(self):
        print("creating temp tables (nodes)");
        self.cursor.execute(sql_queries.sql_create_tmp_tables_nodes);
    def createTmpTablesWays(self):
        print("creating temp tables (ways)");
        self.cursor.execute(sql_queries.sql_create_tmp_tables_ways);
    def createTmpTablesMembers(self):
        print("creating temp tables (members)");
        self.cursor.execute(sql_queries.sql_create_tmp_tables_members);
    def createResultTables(self):
        self.flushBuffer();
        print("creating result tables");
        self.cursor.execute(sql_queries.sql_create_final_tables);
        print ("created");
        self.cursor.execute(sql_queries.sql_drop_tmp_tables);
        #self.conn.commit();
        return;
    def __initBuf(self):
        self.__buf=dict(routes=dict(),stopAreas=dict(),nodes=dict(),
            waysNds=dict(),relsNodes=dict(),relsWays=dict());
        buf=self.__buf;
        for elem in buf:
            buf[elem]["data"]=[];
        buf["routes"]["sql"]="INSERT INTO tmp_routes VALUES";
        buf["stopAreas"]["sql"]="INSERT INTO tmp_stopareas VALUES";
        buf["nodes"]["sql"]="INSERT INTO tmp_nodes_buf VALUES";
        buf["waysNds"]["sql"]="INSERT INTO tmp_waysnd_buf (osm_id, nd_id) VALUES";
        buf["relsNodes"]["sql"]="INSERT INTO tmp_relsnodes_buf (rel_id, node_id) VALUES";
        buf["relsWays"]["sql"]="INSERT INTO tmp_relsways_buf (rel_id, way_id) VALUES";
        buf["routes"]["finalize"]=None;
        buf["stopAreas"]["finalize"]=None;
        buf["nodes"]["finalize"]=sql_queries.sql_finalize_nodes;
        buf["waysNds"]["finalize"]=sql_queries.sql_finalize_waysnd;
        buf["relsNodes"]["finalize"]=sql_queries.sql_finalize_relsnodes;
        buf["relsWays"]["finalize"]=sql_queries.sql_finalize_relsways;

    def __writeData(self,dBuf):
        if len(dBuf["data"])==0:
            return
        strVals= ','.join(dBuf["data"])
        self.cursor.execute(dBuf["sql"]+strVals+";");
        if (dBuf["finalize"]!=None):
            self.cursor.execute(dBuf["finalize"]);
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
        for key in ["name","ref","operator","from","to","route","colour"]:
            data+=(tags[key],);
        strData=self.cursor.mogrify("(%s,%s,%s,%s,%s,%s,%s,%s)",data);
        self.__appendData(self.__buf["routes"],strData);

    def appendStopArea(self,attribs,tags):
        data=(attribs["id"],);
        for key in ["name"]:
            data+=(tags[key],);
        strData=self.cursor.mogrify("(%s,%s)",data);
        self.__appendData(self.__buf["stopAreas"],strData);

    def appendNode(self,attribs,tags):
        geomStr="POINT("+attribs["lon"]+" "+attribs["lat"]+")";
        data=(attribs["id"],tags["name"],tags["shelter"],geomStr);
        strData=self.cursor.mogrify("(%s,%s,%s,ST_GeomFromText(%s,4326))",data);
        self.__appendData(self.__buf["nodes"],strData);

    def appendWayNd(self,wayid,ndid):
        data=(wayid,ndid);
        strData=self.cursor.mogrify("(%s,%s)",data);
        self.__appendData(self.__buf["waysNds"],strData);

    def appendRelNode(self,route_id,node_id):
        data=(route_id,node_id);
        strData=self.cursor.mogrify("(%s,%s)",data);
        self.__appendData(self.__buf["relsNodes"],strData);

    def appendRelWay(self,route_id,way_id):
        data=(route_id,way_id);
        strData=self.cursor.mogrify("(%s,%s)",data);
        self.__appendData(self.__buf["relsWays"],strData);
    def commit(self):
        self.conn.commit();

class PgsqlTarget(PostGisWriter):
    __countNodes=0;
    __countWays=0;
    __countRels=0;
    __finished=False;
    __mode=None;
    def __init__(self,mode,dbname,host=None,user=None,password=None):
        super(PgsqlTarget,self).__init__(dbname,host,user,password);
        self.__mode=mode;
        if (mode=="rels"):
            self.createTmpTables();
        elif (mode=="members"):
            self.createTmpTablesMembers();
        elif (mode=="ways"):
            self.createTmpTablesWays();
        elif (mode=="nodes"):
            self.createTmpTablesNodes();
    def __printStat(self):
        print("{0}\n\tnodes: {1} \n\tways: {2}\n\trels: {3}".format(
            datetime.now(),self.__countNodes,self.__countWays,self.__countRels));
        if self.__finished:
            return
        self.__timer=Timer(6,self.__printStat,());
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
        elif (tag=="nd" and self.__mode=="ways"):
            self.appendWayNd(self.__wayid,attrib["ref"]);
        elif (tag=="relation"):
            self.__relid=attrib["id"];
            self.__attribs=dict(id=attrib["id"]);
            self.__tags=dict();
            for key in ["name","ref","operator","from","to","route","colour","type","public_transport"]:
                self.__tags[key]=None;
        elif (tag=="member" ):
            memtype=attrib["type"];
            ref=attrib["ref"];
            role=attrib["role"];
            if (self.__mode=="members" and memtype=="way" and role in ["","forward","backward"]):
                self.appendRelWay(self.__relid,ref);
            elif (self.__mode=="members" and memtype=="node" and 
                    role in ["","stop","stop_exit_only","stop_entry_only"]):
                self.appendRelNode(self.__relid,ref);
    def end(self, tag):
        if (self.__mode=="nodes" and tag=="node"):
            self.__countNodes+=1;
            self.appendNode(self.__attribs,self.__tags);
        elif (self.__mode=="rels" and tag=="relation"):
            self.__countRels+=1;
            if self.__tags["type"]=="route":
                if self.__tags["route"] in ["bus","trolleybus","tram"]:
                    self.appendRoute(self.__attribs,self.__tags);
            elif (self.__tags["type"]=="public_transport" and 
                    self.__tags["public_transport"]=="stop_area"):
                self.appendStopArea(self.__attribs,self.__tags);
        elif (tag=="osm"):
            self.flushBuffer();
            if (self.__mode=="nodes"):
                self.createResultTables();
            self.commit();
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

def usage():
    sys.stderr.write("Usage: upload_routes_lowdisk.py [rels|members|ways|nodes]\n");
    sys.stderr.write("\trels - create temp tables, upload relations\n");
    sys.stderr.write("\tmembers - upload relation members\n");
    sys.stderr.write("\tways - upload ways\n");
    sys.stderr.write("\tnodes - upload nodes, create result tables\n");


if ( len(sys.argv) != 2 or sys.argv[1] not in ["rels","members","ways","nodes"]):
    usage();
    exit(1);

mode=sys.argv[1];

pgsqlTarget=PgsqlTarget(mode,dbname=db_config.database,
                    host=db_config.host,
                    user=db_config.user,
                    password=db_config.password);
parser=etree.XMLParser(target=pgsqlTarget);
#f=open(flXml,"r");
#etree.parse(f,parser);
etree.parse(sys.stdin,parser);
#f.close();
