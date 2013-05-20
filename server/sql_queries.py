#! /usr/bin/python
# coding: utf-8

#sql queries for upload script
#
#author: gryphon
#license: WTFPL v.2
#$Revision$
#$Date$

sql_create_tmp_tables='''
DROP TABLE IF EXISTS 
                        tmp_nodes, 
                        tmp_waysnd, 
                        tmp_routes, 
                        tmp_routesways, 
                        tmp_routesnodes;
CREATE TABLE tmp_nodes (osm_id BIGINT PRIMARY KEY,
                                             name TEXT,
                                             shelter TEXT,
                                             point geometry(POINT,4326));
CREATE TABLE tmp_waysnd (
                        id BIGSERIAL PRIMARY KEY,
                        osm_id BIGINT NOT NULL,
                        nd_id BIGINT NOT NULL);
CREATE INDEX tmp_waysnd_osm_id_index ON tmp_waysnd(osm_id);
CREATE INDEX tmp_waysnd_nd_id_index ON tmp_waysnd(nd_id);
CREATE TABLE tmp_routes (osm_id BIGINT PRIMARY KEY,
                                             name TEXT,
                                             ref TEXT,
                                             operator TEXT,
                                             "from" TEXT,
                                             "to" TEXT,
                                             route TEXT,
                                             color TEXT
        ); 
CREATE TABLE tmp_routesways (
                        id BIGSERIAL PRIMARY KEY,
                        route_id BIGINT NOT NULL,
                        way_id BIGINT NOT NULL 
        );
CREATE INDEX tmp_routesways_route_id_index ON tmp_routesways(route_id);
CREATE INDEX tmp_routesways_way_id_index ON tmp_routesways(way_id);
CREATE TABLE tmp_routesnodes (
                        id BIGSERIAL PRIMARY KEY,
                        route_id BIGINT NOT NULL, 
                        node_id BIGINT NOT NULL
        );
CREATE INDEX tmp_routesnodes_route_id_index ON tmp_routesnodes(route_id);
CREATE INDEX tmp_routesnodes_node_id_index ON tmp_routesnodes(node_id);
''';

sql_create_final_tables='''
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
    );

INSERT INTO routes2busstops (
    SELECT id,route_id,node_id
    FROM tmp_routesnodes rn JOIN routes r
        ON (rn.route_id=r.osm_id)
        JOIN busstops b
        ON (b.osm_id=rn.node_id)
    );

'''
sql_drop_tmp_tables='''
DROP TABLE IF EXISTS 
                        tmp_nodes, 
                        tmp_waysnd, 
                        tmp_routes, 
                        tmp_routesways, 
                        tmp_routesnodes;
'''
