#! /usr/bin/python
# coding: utf-8

import psycopg2
import json
import db_config
from mod_python import apache
from mod_python import util

def createJSON(routes,busstops,routes2busstops):
    keysr=["osm_id","name","ref","operator","from","to","route","color","lines"];
    keysb=["osm_id","name","shelter","point"];
    arResult=dict(routes=[],busstops=[],routes2busstops=dict());
    routesstops=dict();
    for rec in routes2busstops:
        if not rec[0] in routesstops:
            routesstops[rec[0]]=[];
        routesstops[rec[0]].append(rec[1]);
    for rec in routes:
        arResult["routes"].append(dict());
        num=len(arResult["routes"])-1;
        for i in range(len(keysr)):
            if keysr[i]=="lines":
                arResult["routes"][num][keysr[i]]=json.loads(rec[i]);
                lines=arResult["routes"][num][keysr[i]]["coordinates"];
                for line in lines:
            	    for point in line:
            		point.reverse(); # leaflet
            else:
                arResult["routes"][num][keysr[i]]=rec[i];
        if arResult["routes"][num]["osm_id"] in routesstops:
    	    arResult["routes"][num]["stops_ids"]=routesstops[arResult["routes"][num]["osm_id"]];
    for rec in busstops:
        arResult["busstops"].append(dict());
        num=len(arResult["busstops"])-1;
        for i in range(len(keysb)):
            if keysb[i]=="point":
                arResult["busstops"][num][keysb[i]]=json.loads(rec[i]);
                arResult["busstops"][num][keysb[i]]["coordinates"].reverse();                
            else:
                arResult["busstops"][num][keysb[i]]=rec[i];
    #return json.dumps(arResult,indent=4);
    return json.dumps(arResult);

def getroutes(req):
    #req.log_error("test");
    fs=util.FieldStorage(req);
    bboxe=fs.getfirst("bboxe");
    bboxw=fs.getfirst("bboxw");
    bboxn=fs.getfirst("bboxn");
    bboxs=fs.getfirst("bboxs");
    if (bboxe is None or bboxw is None or bboxn is None or bboxs is None):
        req.status=apache.HTTP_NOT_FOUND;
        return "This is a error"
    #polygon="POLYGON(({0} {1}, {2} {3}, {4} {5}, {6} {7}, {0} {1}))".format(
    polygon="LINESTRING({0} {1}, {2} {3}, {4} {5}, {6} {7}, {0} {1})".format(
	bboxe,bboxs,bboxe,bboxn,bboxw,bboxn,bboxw,bboxs)
    conn=psycopg2.connect(database=db_config.database,
                            user=db_config.user,
                            password=db_config.password,
                            host=db_config.host);
    cur=conn.cursor();
    cur.execute("""
        SELECT osm_id,name,ref,operator,"from","to",route,color,ST_AsGeoJSON(lines) 
            INTO TEMP tt_routes
		FROM routes 
		-- WHERE ST_GeomFromText(s,4326) && lines 
		WHERE ST_Intersects(ST_GeomFromText(%s,4326),lines) 
             OR lines @ ST_GeomFromText(%s,4326)
		;
        SELECT rb.route_id,busstop_id
            INTO TEMP tt_routes2busstops
        FROM routes2busstops rb JOIN tt_routes r
        ON (rb.route_id=r.osm_id)
        ORDER BY id
        ;
        """
        ,(polygon,polygon));
    cur.execute("SELECT * FROM tt_routes;");
    routes=cur.fetchall();
    cur.execute("SELECT * FROM tt_routes2busstops;");
    routes2busstops=cur.fetchall();
    cur.execute("""
        SELECT osm_id,name,shelter,ST_AsGeoJSON(point) 
        FROM busstops b JOIN tt_routes2busstops rb
        ON (b.osm_id=rb.busstop_id)
        ;
        """);
    busstops=cur.fetchall();
    result=createJSON(routes,busstops,routes2busstops);
    cur.close();
    conn.close();
    req.content_type = "application/json";
    req.status=apache.HTTP_OK;
    req.headers_out['access-control-allow-origin']='*';
    #req.write(result);
    return result;

#strJson=test();
#open("out.txt","w").write(strJson);


