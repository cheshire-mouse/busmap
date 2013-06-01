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
                        tmp_stopareas, 
                        tmp_relsways, 
                        tmp_relsnodes;
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
CREATE TABLE tmp_stopareas(osm_id BIGINT PRIMARY KEY,
                                             name TEXT
        ); 
CREATE TABLE tmp_relsways (
                        id BIGSERIAL PRIMARY KEY,
                        rel_id BIGINT NOT NULL,
                        way_id BIGINT NOT NULL 
        );
CREATE INDEX tmp_relsways_rel_id_index ON tmp_relsways(rel_id);
CREATE INDEX tmp_relsways_way_id_index ON tmp_relsways(way_id);
CREATE TABLE tmp_relsnodes (
                        id BIGSERIAL PRIMARY KEY,
                        rel_id BIGINT NOT NULL, 
                        node_id BIGINT NOT NULL
        );
CREATE INDEX tmp_relsnodes_rel_id_index ON tmp_relsnodes(rel_id);
CREATE INDEX tmp_relsnodes_node_id_index ON tmp_relsnodes(node_id);
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

SELECT rw.id, rw.way_id,rw.rel_id 
INTO TEMP tt_relsways
FROM tmp_routes r JOIN tmp_relsways rw
    ON (r.osm_id=rw.rel_id)
ORDER BY rw.id;

CREATE INDEX tt_relsways_id_index ON tt_relsways(id);
CREATE INDEX tt_relsways_rel_id_index ON tt_relsways(rel_id);

SELECT rn.id, rn.node_id,rn.rel_id 
INTO TEMP tt_relsnodes
FROM tmp_routes r JOIN tmp_relsnodes rn
    ON (r.osm_id=rn.rel_id)
ORDER BY rn.id;

CREATE INDEX tt_relsnodes_id_index ON tt_relsnodes(id);
CREATE INDEX tt_relsnodes_rel_id_index ON tt_relsnodes(rel_id);

SELECT DISTINCT w.id, w.osm_id, w.nd_id 
INTO TEMP tt_waysnds
FROM tmp_waysnd w JOIN tt_relsways rw
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

DELETE FROM tt_relsways
WHERE rel_id IN (
    SELECT DISTINCT rel_id 
    FROM tt_relsways rw LEFT OUTER JOIN tt_waysnds w
        ON (rw.way_id=w.osm_id)
    WHERE w.osm_id IS NULL) 
;

DELETE FROM tt_relsnodes
WHERE rel_id IN (
    SELECT DISTINCT rel_id 
    FROM tt_relsnodes rn LEFT OUTER JOIN tmp_nodes n
        ON (rn.node_id=n.osm_id)
    WHERE n.osm_id IS NULL) 
;

DELETE FROM tmp_routes 
WHERE osm_id NOT IN (
    SELECT DISTINCT rel_id 
    FROM tt_relsways) 
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

SELECT rel_id, 
       ST_Simplify(ST_Multi(ST_LineMerge(ST_Union(line))),0.00005) mline
INTO TEMP tt_routesgeom
FROM (SELECT rel_id, line 
    FROM tt_relsways rw JOIN tt_ways w
    ON (rw.way_id=w.way_id)
    ORDER BY rw.id
    ) as rwl
GROUP BY rel_id
;

CREATE INDEX tt_routesgeom_rel_id ON tt_routesgeom (rel_id);

-- write the result into permanent tables

DELETE FROM routes2busstops;
DELETE FROM busstops;
DELETE FROM routes;

INSERT INTO routes (
    SELECT osm_id,name,ref,operator,"from","to",route,color,mline 
    FROM tmp_routes r JOIN tt_routesgeom rg
        ON (r.osm_id=rg.rel_id)
        );

INSERT INTO busstops (
    SELECT osm_id,point,name,shelter
        FROM 	tmp_nodes n JOIN 
        (SELECT DISTINCT node_id 
        FROM tt_relsnodes) as rn
        ON (n.osm_id=rn.node_id)
    );

INSERT INTO routes2busstops (
    SELECT id,rel_id,node_id
    FROM tmp_relsnodes rn JOIN routes r
        ON (rn.rel_id=r.osm_id)
        JOIN busstops b
        ON (b.osm_id=rn.node_id)
    );

-- update stop names from stopareas

SELECT rn.node_id as osm_id,sa.name
INTO TEMP tt_stopnames
FROM tmp_relsnodes rn JOIN tmp_stopareas sa
    ON (rn.rel_id=sa.osm_id);

CREATE INDEX tt_stopnames_osm_id_index ON tt_stopnames(osm_id);

SELECT osm_id
INTO TEMP tt_stopnames_dups
FROM (
    SELECT osm_id,count(*) as cnt 
    FROM tt_stopnames
    GROUP BY osm_id) as tt_cnt
WHERE cnt > 1;

DELETE FROM tt_stopnames
WHERE osm_id in (
    SELECT osm_id FROM tt_stopnames_dups)
;

UPDATE busstops SET name=sn.name
FROM tt_stopnames as sn
WHERE busstops.osm_id=sn.osm_id;

'''
sql_drop_tmp_tables='''
DROP TABLE IF EXISTS 
                        tmp_nodes, 
                        tmp_waysnd, 
                        tmp_routes, 
                        tmp_stopareas, 
                        tmp_relsways, 
                        tmp_relsnodes;
'''
