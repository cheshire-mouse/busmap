// busmap scripts
// author: gryphon
// license: WTFPL v.2
// $Revision$
// $Date$


var map;
var routes;
var busstops;
//var routeLayers=new Array();
//var busstopLayers=new Array();
var xmlhttp=null;
var activeRoute=null;
var activeRouteOsmId=null;
var activeBusstop=null;
var activeBusstopOsmId=null;
var busstopsAllowed=true;
var openedPopupLatLnt=null;
var openedPopupType=null;
var autoRefresh=false;

var visibleCount=0;
var visibleRoutes=new Array();
var allVisible=true;

var defaultOpacity=0.5;
var defaultWeight=5;
var activeOpacity=1;
var activeWeight=10;

var cancelNextMapMoveEvent=false;

var layerRoutes;
var layerBusstops;

var mapRoutes;
var mapBusstops;

function initmap() {
	// set up the map
	resizePage();
	window.onresize=resizePage;
	map = new L.Map('map');

	// create the tile layer with correct attribution
	var osmUrl='http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	//var osmUrl="http://{s}.www.toolserver.org/tiles/bw-mapnik/{z}/{x}/{y}.png";
	var osmAttrib='Map data © OpenStreetMap contributors';
	var osm = new L.TileLayer(osmUrl, { minZoom: 1, maxZoom: 18, attribution: osmAttrib});		

	//map.setView(new L.LatLng(0, 0),1);
	map.locate({setView:true});
	map.addLayer(osm);
	//chkAllowStopsOnChange();
	//chkAutorefreshOnChange();
	document.addEventListener("routesupdateend",docOnRoutesUpdateEnd);
	//map.on('popupclose',mapOnPopupClose);
}

function getRoutePopupHTML(route,withBusstops){
	//console.debug("getRoutePopupHTML");
	//console.debug("\troute "+route.name);
	//console.debug("\twithRoutes "+withBusstops.toString());
	var fields=new Array();
	fields.push({id:"ref",name:"Номер"});
	fields.push({id:"from",name:"Откуда"});
	fields.push({id:"to",name:"Куда"});
	fields.push({id:"operator",name:"Владелец"});
	var description="";
	if (route.name!=null) description +="<h3>"+route.name+"</h3>";
	description+="<table>";
	for (var i in fields){
		if (route[fields[i].id]!=null) 
			description +="<tr><td>"+fields[i].name+
				"</td><td>"+route[fields[i].id]+"</td></tr>";
	}
	description+="</table>";
	if (withBusstops){
		description+="<div style=max-height:150px;overflow:auto>";
		for (var i in route.stops){
			if (i>0) description+="<br>";
			var stop_id=route.stops[i].osm_id;
			description+="<a onclick=popupBusstopOnClick(event) value="+stop_id+">";
			description+=(route.stops[i].name!=null)?(route.stops[i].name):("-???-");
			description+="</a>";
		}
		description+="</div>";
	}
	return description;
}

function getBusstopPopupHTML(stop,withRoutes){
	//console.debug("getBusstopPopupHTML");
	var descr="";
	if (stop.name!=null)
		descr="<h3>"+stop.name+"</h3>";
	//console.debug("\tstop "+stop.name);
	//console.debug("\twithRoutes "+withRoutes.toString());
	if (withRoutes){
		descr+="<div style=max-height:200px;overflow:auto>";
		for ( var i in stop.routes){
			var route_id=stop.routes[i].osm_id;
			var checked=stop.routes[i].isVisible?("checked"):("");
			if (i>0) descr+="<br>";
			descr+="<input type=checkbox "+checked+
					" id=popup_route_"+route_id+
					" value="+route_id+
					" onchange=chkPopupOnChange(event) "+">"+
					"<span style=color:"+stop.routes[i].color+">\u2588 </span>";
			descr+="<a onclick=popupRouteOnClick(event) value="+route_id+">";
			descr+=stop.routes[i].name;
			descr+="</a>";
		}
		descr+="</div>"
	}
	return descr;
}

function getRouteName(route){
	var name="";
	if (route.name!=null) return route.name;
	if (route.ref!=null) name=route.ref;
	if (route.from!=null && route.to!=null){
		if (name!="") name+=" ";
		name+=route.from+" - "+route.to;
	}
	return name;
}

	

function generateColorFromRef(ref){
	var color;
	num=parseInt(ref,10);
	if ( isNaN(num) || num < 1 ) 
		return null;
		//color="#"+Math.floor(Math.random()*0xffffff).toString(16);
	else {
		//i can't say for sure what this formula does 
		//so don't use it if you do not.... just don't use it at all
		p=3; //magic number, do not use 2^n
		b=Math.pow( p, Math.floor( Math.log(num) / Math.log(p) ) + 1 );
		var astart=1;
		var aend=num-b/p+1;
		for (a=astart; a<=aend;a++)
			if (a/p==Math.floor(a/p)) aend++;
		a--;
		color="#"+pad( Math.floor(1.0*a/b*0xffffff).toString(16) , 6 );
		//console.debug("color "+color+" "+num+" "+(a)+"/"+b);
	}
	return color;
}

function processJSON(){
	if (xmlhttp.readyState != 4) return;
	if (xmlhttp.status != 200){
		alert(xmlhttp.status+" "+xmlhttp.statusText);
		enableButtons();
		return;
	}
	var routesJson=JSON.parse(xmlhttp.responseText);

	busstops=routesJson["busstops"];
	mapBusstops=new Object();
	for (var i in busstops){
		mapBusstops[busstops[i].osm_id]=busstops[i];
		busstops[i].routes=new Array();
		busstops[i].routesRefs=new Array();
		busstops[i].visibleRoutes=0;
		busstops[i].point.properties=new Object();
		busstops[i].point.properties.osm_id=busstops[i].osm_id;
	}

	routes=routesJson["routes"];
	
	for ( var i in routes ) routes[i].name=getRouteName(routes[i]);
	routes.sort(compareRoutes);
	
	visibleCount=0;
	if (allVisible) visibleRoutes=new Array();
	mapRoutes=new Object();
	for ( var i in routes ) {
		routes[i].lines.properties=new Object();
		if (routes[i].color==null)  routes[i].color=generateColorFromRef(routes[i].ref);
		if (routes[i].color==null)  routes[i].color=generateColorFromRef(routes[i].osm_id);
		if (visibleRoutes[routes[i].osm_id]==true || allVisible){			
			routes[i].isVisible=true;
			visibleRoutes[routes[i].osm_id]=visibleRoutes[routes[i].osm_id]||allVisible;
			visibleCount++;
		}
		routes[i].stops=new Array();
		var stops_ids=routes[i].stops_ids;
		for (var s in stops_ids){
			var s_id=stops_ids[s];
			var stop=mapBusstops[s_id];
			routes[i].stops.push(stop);
			stop.routes.push(routes[i]);
			if (routes[i].ref != null)
				stop.routesRefs.push(routes[i].ref);
		}
		routes[i].popupContent=getRoutePopupHTML(routes[i],true);
		routes[i].lines.properties.color=routes[i].color;
		routes[i].lines.properties.osm_id=routes[i].osm_id;
		mapRoutes[routes[i].osm_id]=routes[i];
	}
	if (routes.length==0) {
		allVisible=true;
		visibleRoutes=new Array();
	}
	for (var i in busstops)
		busstops[i].popupContent=getBusstopPopupHTML(busstops[i],true);
	createCheckboxes();
	generateLayers();
	addLayers();
	enableButtons();
	xmlhttp=null;
	var evn=new CustomEvent("routesupdateend");
	document.dispatchEvent(evn);
}


function requestRoutes() {
	var bbox=new Object();
	bbox.N=map.getBounds().getNorthEast().lat;
	bbox.E=(map.getBounds()).getNorthEast().lng;
	bbox.S=map.getBounds().getSouthWest().lat;
	bbox.W=map.getBounds().getSouthWest().lng;
	strBbox=""+bbox.S+","+bbox.W+","+bbox.N+","+bbox.E;
	//console.debug(strBbox);
	if (window.XMLHttpRequest) {
   		xmlhttp=new XMLHttpRequest();
	   }
 	else {
		return;
	}
	//json_url='http://198.199.107.98/routes.py/getroutes?'+
	json_url='http://postgis/routes.py/getroutes?'+
		'bboxe='+bbox.E+'&bboxw='+bbox.W+'&bboxn='+bbox.N+'&bboxs='+bbox.S;
	xmlhttp.open("GET",json_url,true);
	xmlhttp.onreadystatechange=processJSON;
	xmlhttp.send(null);
	disableButtons();
}

function createCheckboxes(){
	td=document.getElementById("divRoutesList");
	while (td.firstChild) td.removeChild(td.firstChild);
	
	for (var i in routes){
		var checkbox= document.createElement("input");
		checkbox.type="checkbox";
		checkbox.id="route_"+routes[i].osm_id;
		checkbox.value=routes[i].osm_id;
		if (routes[i].isVisible) checkbox.checked=true;
		checkbox.addEventListener("change",checkOnChange);
		span=document.createElement("span");
		span.style.color=routes[i].color;
		colorMarker=document.createTextNode("\u2588 ");
		text=document.createTextNode(routes[i].name);
		br=document.createElement('br');
		span.appendChild(colorMarker);
		td.appendChild(checkbox);
		td.appendChild(span);
		td.appendChild(text);
		td.appendChild(br);
	}
}

function generateLayers(){
	layerRoutes=new L.GeoJSON([],{
		onEachFeature: onEachRouteFeature	
	});
	for (var i in routes){
		layerRoutes.addData(routes[i].lines);
	}
	layerBusstops=new L.GeoJSON([],{
		pointToLayer: function(data,latlng){
			return L.circleMarker(latlng);
		},
		onEachFeature: onEachBusstopFeature	
	});
	for (var i in busstops){
		layerBusstops.addData(busstops[i].point);
	}
}

function onEachRouteFeature(data,layer){
	layer.setStyle({color:data.properties.color});
	var route=mapRoutes[data.properties.osm_id];
	//layer.bindPopup(route.popupContent);
	layer.on('click',routeOnClick);
	route.layer=layer;
}

function onEachBusstopFeature(data,layer){
	var busstop=mapBusstops[data.properties.osm_id];
	layer.on('click',busstopOnClick);
	busstop.layer=layer;
}

function addLayers(){
	map.addLayer(layerRoutes);
	//map.addLayer(layerBusstops);
}

function addAllBusstopLayers(){
	for (var i in busstops)
		if ( busstops[i].visibleRoutes > 0 )
			map.addLayer(busstops[i].layer);
}

function removeAllBusstopLayers(){
	for (var i in busstops)
		if ( busstops[i].visibleRoutes > 0 )
			map.removeLayer(busstops[i].layer);
}

function bringBusstopsToFront(){
	if (!busstopsAllowed) return;
	for (var i in routes)
		if ( routes[i].isVisible  )
			for (var j in routes[i].stops)
				routes[i].stops[j].layer.bringToFront();
}

function disableButtons(){
	document.getElementById("btnRefresh").disabled=true;
}

function enableButtons(){
	document.getElementById("btnRefresh").disabled=false;
}

function checkOnChange(e){
	var routeid=e.target.value;
	var isChecked=e.target.checked;
	var route=mapRoutes[routeid];
	chkPopup=document.getElementById("popup_route_"+routeid);
	if (chkPopup != null) chkPopup.checked=isChecked;
	changeRouteVisibility(route,isChecked);
}

function chkPopupOnChange(e){
	var isChecked=e.target.checked;
	var routeid=e.target.value;
	var route=mapRoutes[routeid];
	document.getElementById("route_"+routeid).checked=isChecked;
	changeRouteVisibility(route,isChecked);
}

function changeRouteVisibility(route,isVisible){
	route.isVisible=isVisible;
	if (isVisible){
		layerRoutes.addLayer(route.layer);
		for (var i in route.stops)
			layerBusstops.addLayer(route.stops[i].layer);
	}
	else {
		layerRoutes.removeLayer(route.layer);
		for (var i in route.stops)
			layerBusstops.removeLayer(route.stops[i].layer);
	}
}

function chkAllowStopsOnChange(){
	var chk=document.getElementById("chkAllowStops")
	busstopsAllowed=chk.checked;
	//if ( busstopsAllowed ) addAllBusstopLayers();
	//else  removeAllBusstopLayers();
	if ( busstopsAllowed ) map.addLayer(layerBusstops);
	else  map.removeLayer(layerBusstops);
}

function checkAll(){
	//console.debug("visibleCount "+visibleCount+" routes.length "+routes.length);
	for (var i=0; i<routes.length;i++){
		chk=document.getElementById("route"+i);
		chk.checked=(visibleCount<routes.length);
		routes[i].isVisible=chk.checked;
		visibleRoutes[routes[i].osm_id]=chk.checked;
	}
	if (visibleCount<routes.length) visibleCount=routes.length;
	else visibleCount=0;
	allVisible=(visibleCount==routes.length);
}

function compareRoutes(a,b){
	if (a.name < b.name)
		return -1;
	if (a.name > b.name)
		return 1;
	return 0;
}

function compareRefs(a,b){
	if (parseInt(a) < parseInt(b)) return -1;
	if (parseInt(a) > parseInt(b)) return 1;
	if ( a < b ) return -1;
	if ( a > b ) return 1;
	return 0;
}

//requires js 1.6
function filterUnique(value, index, self) { 
	    return self.indexOf(value) === index;
}

function pad(str,num){
	var result_str="000000000000000000"+str;
	return result_str.substring(result_str.length-num,result_str.length);
}

function btnRefreshOnClick() {
	if (xmlhttp==null) requestRoutes();
}

function btnCheckAllOnClick() {
	checkAll();
	addLayers();
}

function chkAutorefreshOnChange(){
	var chk=document.getElementById("chkAutorefresh");
	autoRefresh=chk.checked;
	if (chk.checked) map.on('moveend',mapOnMoveend);
	else map.off('moveend',mapOnMoveend);
}

function activateRoute(layer,popupCoord){
	var routeid=layer.feature.properties.osm_id;
	var route=mapRoutes[routeid];
	if (activeRoute!=null) 
		activeRoute.layer.setStyle({opacity:defaultOpacity,weight:defaultWeight});
	if (activeRoute!=null && activeRoute.osm_id==routeid)	{
		activeRoute=null;
		map.closePopup();
	}
	else {
		layer.setStyle({opacity:activeOpacity,weight:activeWeight});
		layer.bringToFront();
		var popup = L.popup();
		popup.setLatLng(popupCoord);
		popup.setContent(route.popupContent);
		activeRoute=route;
		map.openPopup(popup);
	}
}

function routeOnClick(e){
	var layer=e.target;
	var popupCoord=e.latlng;
	activateRoute(layer,popupCoord);
}

function popupRouteOnClick(e){
	var route_ind=e.target.attributes.value.value;
	var layer=routeLayers[route_ind];
	var popupCoord=openedPopupLatLng;
	activateRoute(layer,popupCoord);
	if (activeRoute==null) activateRoute(layer,popupCoord);
}

function activateBusstop(layer){
	var stopid=layer.feature.properties.osm_id;
	var stop=mapBusstops[stopid];
	var popup = L.popup();
	popup.setLatLng(layer.getLatLng());
	popup.setContent(stop.popupContent);
	map.openPopup(popup);
}

function busstopOnClick(e){
	var layer=e.target;
	activateBusstop(layer);
}
function popupBusstopOnClick(e){
	if (xmlhttp!=null) return;
	var stop_ind=e.target.attributes.value.value;
	var layer=busstopLayers[stop_ind];
	map.setView(layer.getLatLng(),map.getZoom());
	activateBusstop(layer);
}


function mapOnMoveend(e){
	//console.debug("mapOnMoveend");
	if (cancelNextMapMoveEvent){
		cancelNextMapMoveEvent=false;
		//console.debug("\tcanceled");
		return;
	}
	if (xmlhttp==null) requestRoutes();
}

function mapOnPopupClose(e){
	//console.debug("mapOnPopupClose");
	openedPopupLatLnt=null;
	openedPopupType=null;
}

function resizePage(){
	var height = 0;
	var width = 0;
	var listWidth=250;
	var body = window.document.body;
	if (window.innerHeight) {
		height = window.innerHeight;
	} else if (body.parentElement.clientHeight) {
		height = body.parentElement.clientHeight;
	} else if (body && body.clientHeight) {
		height = body.clientHeight;
	}
	if (window.innerWidth) {
		width = window.innerWidth;
	} else if (body.parentElement.clientWidth) {
		width = body.parentElement.clientWidth;
	} else if (body && body.clientWidth) {
		width = body.clientWidth;
	}
	var divMap=document.getElementById("map");
	var divList=document.getElementById("divRoutesList");
	var cellList=document.getElementById("cellRoutesList");
	var cellLeft=document.getElementById("cellLeft");
	var cellMap=document.getElementById("cellMap");
	document.getElementById("tableMain").style.height=height+"px";
	listWidth=Math.min(listWidth,width*0.25);
	divList.style.width=listWidth+"px";
	document.getElementById("tableLeft").style.height=cellLeft.clientHeight+"px";
	divMap.style.height=cellMap.clientHeight+"px";
	divMap.style.width=cellMap.clientWidth+"px";
	divList.style.height=cellList.clientHeight+"px";
}

function updatePopupContent(popupAutoPan){
	//console.debug("updatePopupContent");
	if (openedPopupType==null) return;
	var content="";
	if (openedPopupType=="route") content=getRoutePopupHTML(activeRoute,true);
	if (openedPopupType=="busstop") content=getBusstopPopupHTML(activeBusstop,true);
	var popup = L.popup({autoPan:popupAutoPan});
	popup.setLatLng(openedPopupLatLng);
	popup.setContent(content);
	map.off('popupclose',mapOnPopupClose); // no need in clearing popup params
	map.openPopup(popup);
	map.on('popupclose',mapOnPopupClose);
}

function docOnRoutesUpdateEnd(e){
	//console.debug("docOnRoutesUpdateEnd");
	updatePopupContent(false);
}
