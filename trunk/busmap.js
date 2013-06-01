// busmap scripts
// author: gryphon
// license: WTFPL v.2
// $Revision$
// $Date$
// $HeadURL$


var map;
var routes=new Array();
var busstops=new Array();
//var routeLayers=new Array();
//var busstopLayers=new Array();
var xmlhttp=null;
var activeRoute=null;
//var activeRouteOsmId=null;
var activeBusstop=null;
//var activeBusstopOsmId=null;
var busstopsAllowed=true;
var openedPopupLatLng=null;
var openedPopupType=null;
//var openedPopup=null;
var autoRefresh=false;

var visibleCount=0;
//var visibleRoutes=new Array();
//var allVisible=true;

var defaultRouteStyle={opacity:0.5,weight:5};
var activeRouteStyle={opacity:1,weight:10};
var defaultBusstopStyle={opacity:0.5,fillOpacity:0.2,color:"blue",fillColor:"blue"};
var activeBusstopStyle={opacity:1,fillOpacity:1,color:"blue",fillColor:"orange"};

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
	var osmAttrib='Map data © '+
		'<a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'+
		' contributors';
	var osm = new L.TileLayer(osmUrl, { minZoom: 1, maxZoom: 18, attribution: osmAttrib});		

	//map.setView(new L.LatLng(0, 0),1);
	map.locate({setView:true});
	map.addLayer(osm);

	layerRoutes=new L.GeoJSON([],{
		onEachFeature: onEachRouteFeature	
	});
	layerBusstops=new L.GeoJSON([],{
		pointToLayer: function(data,latlng){
			return L.circleMarker(latlng,defaultBusstopStyle);
		},
		onEachFeature: onEachBusstopFeature	
	});

	//chkAllowStopsOnChange();
	//chkAutorefreshOnChange();
	busstopsAllowed=document.getElementById("chkAllowStops").checked;
	document.addEventListener("routesupdateend",docOnRoutesUpdateEnd);
	map.on('popupclose',mapOnPopupClose);
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

	var allVisible=false;
	allVisible=(visibleCount==routes.length);
	var mapVisibleRoutes=new Object();
	if (!allVisible)
		for (var i in routes)
			if (routes[i].isVisible) mapVisibleRoutes[routes[i].osm_id]=true;
	visibleCount=0;
	setRouteStyle(activeRoute,false);
	layerRoutes.clearLayers();
	layerBusstops.clearLayers();

	busstops=routesJson["busstops"];
	mapBusstops=new Object();
	var activeBusstopFound=false;
	for (var i in busstops){
		mapBusstops[busstops[i].osm_id]=busstops[i];
		busstops[i].routes=new Array();
		busstops[i].visibleRoutes=0;
		busstops[i].point.properties=new Object();
		busstops[i].point.properties.osm_id=busstops[i].osm_id;
		if (activeBusstop!=null && busstops[i].osm_id==activeBusstop.osm_id){
			activeBusstop=busstops[i];
			activeBusstopFound=true;
		}
	}
	if (!activeBusstopFound) activeBusstop=null;

	routes=routesJson["routes"];
	
	mapRoutes=new Object();
	var activeRouteFound=false;
	for ( var i in routes ) {
		routes[i].name=getRouteName(routes[i]);
		if (routes[i].color==null)  routes[i].color=generateColorFromRef(routes[i].ref);
		if (routes[i].color==null)  routes[i].color=generateColorFromRef(routes[i].osm_id);
		if (allVisible || mapVisibleRoutes[routes[i].osm_id]==true)
			routes[i].isVisible=true;
		routes[i].stops=new Array();
		var stops_ids=routes[i].stops_ids;
		for (var s in stops_ids){
			var s_id=stops_ids[s];
			var stop=mapBusstops[s_id];
			routes[i].stops.push(stop);
			stop.routes.push(routes[i]);
		}
		routes[i].popupContent=getRoutePopupHTML(routes[i],true);
		//console.debug(routes[i].name);
		routes[i].lines.coordinates=mergeLines(routes[i].lines.coordinates);
		routes[i].lines.properties=new Object();
		routes[i].lines.properties.color=routes[i].color;
		routes[i].lines.properties.osm_id=routes[i].osm_id;
		mapRoutes[routes[i].osm_id]=routes[i];
		if (activeRoute!=null && routes[i].osm_id==activeRoute.osm_id){
			activeRoute=routes[i];
			activeRouteFound=true;
		}
	}
	routes.sort(compareRoutes);
	for (var i in busstops)
		busstops[i].popupContent=getBusstopPopupHTML(busstops[i],true);
	for (var i in routes)
		addRouteToLayer(routes[i]);
	addLayers();
	if (busstopsAllowed) layerBusstops.bringToFront();
	if (activeRouteFound) setRouteStyle(activeRoute,true);
	else activeRoute=null;
	createCheckboxes();
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
		var span=document.createElement("span");
		span.style.color=routes[i].color;
		colorMarker=document.createTextNode("\u2588 ");
		var text=document.createTextNode(routes[i].name);
		var href=document.createElement("a");
		href.textContent=routes[i].name;
		href.addEventListener("click",listRouteOnClick);
		href.value=routes[i].osm_id;
		var br=document.createElement('br');
		span.appendChild(colorMarker);
		td.appendChild(checkbox);
		td.appendChild(span);
		//td.appendChild(text);
		td.appendChild(href);
		td.appendChild(br);
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
	layer.bindLabel(busstop.name,{noHide:true});
}

function addLayers(){
	map.addLayer(layerRoutes);
	if (busstopsAllowed) map.addLayer(layerBusstops);
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
	setRouteVisibility(route,isChecked);
	if (isChecked) moveActiveRouteToFront();
}

function chkPopupOnChange(e){
	var isChecked=e.target.checked;
	var routeid=e.target.value;
	var route=mapRoutes[routeid];
	document.getElementById("route_"+routeid).checked=isChecked;
	setRouteVisibility(route,isChecked);
	if (isChecked) moveActiveRouteToFront();
}

function addRouteToLayer(route){
	layerRoutes.addData(route.lines);
	if (route.isVisible) visibleCount++;
	else layerRoutes.removeLayer(route.layer);
	for (var i in route.stops){
		var stop=route.stops[i];
		if (stop.visibleRoutes==0) layerBusstops.addData(stop.point);
		if (route.isVisible) stop.visibleRoutes++;
		if (stop.visibleRoutes==0) layerBusstops.removeLayer(stop.layer);
	}

}

function setRouteVisibility(route,isVisible){
	if (route.isVisible==isVisible) return;
	route.isVisible=isVisible;
	if (isVisible){
		visibleCount++;
		layerRoutes.addLayer(route.layer);
		for (var i in route.stops){
			route.stops[i].visibleRoutes++;
			layerBusstops.addLayer(route.stops[i].layer);
		}
	}
	else {
		visibleCount--;
		layerRoutes.removeLayer(route.layer);
		for (var i in route.stops){
			route.stops[i].visibleRoutes--;
			if (route.stops[i].visibleRoutes==0)
				layerBusstops.removeLayer(route.stops[i].layer);
		}
	}
}

function chkAllowStopsOnChange(){
	var chk=document.getElementById("chkAllowStops")
	busstopsAllowed=chk.checked;
	//if ( busstopsAllowed ) addAllBusstopLayers();
	//else  removeAllBusstopLayers();
	if ( busstopsAllowed ) {
		map.addLayer(layerBusstops);
		moveActiveRouteToFront();
	}
	else  map.removeLayer(layerBusstops);
}

function checkAll(){
	//console.debug("visibleCount "+visibleCount+" routes.length "+routes.length);
	var visible=(visibleCount<routes.length);
	for (var i=0; i<routes.length;i++){
		document.getElementById("route_"+routes[i].osm_id).checked=visible;
		chkPopup=document.getElementById("popup_route_"+routes[i].osm_id);
		if (chkPopup != null) chkPopup.checked=visible;
		setRouteVisibility(routes[i],visible);
	}
	moveActiveRouteToFront();
}

function moveActiveRouteToFront(){
	if (activeRoute==null || !activeRoute.isVisible) return;
	activeRoute.layer.bringToFront();
	//if (busstopsAllowed){
		//layerBusstops.bringToFront();
		for (var i in activeRoute.stops)
			activeRoute.stops[i].layer.bringToFront();
	//}
}

//merge adjucent lines in the array of lines
//result is still array of lines (if there are no gaps
//it will contain only one element)
function mergeLines(arLines){
        //console.debug("mergeLines, in: "+arLines.length);
        if (arLines.length<2) return arLines;
        var arMergedLines=new Array();
        for (var i=0;i<arLines.length-1;i++){
                ar1first=arLines[i][0];
                ar1last=arLines[i][arLines[i].length-1];
                ar2first=arLines[i+1][0];
                ar2last=arLines[i+1][arLines[i+1].length-1];
                if ( pairsEqual(ar1first,ar2first) ) arLines[i].reverse();
                else if ( pairsEqual(ar1last,ar2last) ) arLines[i+1].reverse();
                else if ( pairsEqual(ar1first,ar2last) ) {
                        arLines[i].reverse();
                        arLines[i+1].reverse();
                }
                ar2first=arLines[i+1][0];
                ar1last=arLines[i][arLines[i].length-1];
                if ( pairsEqual(ar2first,ar1last) ){
                        arLines[i].pop();
                        arLines[i+1]=arLines[i].concat(arLines[i+1]);
                }
                else arMergedLines.push(arLines[i]);
        }
        arMergedLines.push(arLines[arLines.length-1]);
        //console.debug("mergeLines, out: "+arMergedLines.length);
        return arMergedLines;
} 

function pairsEqual(a,b){
	return ( a[0] == b[0] && a[1] == b[1] );
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

function pad(str,num){
	var result_str="000000000000000000"+str;
	return result_str.substring(result_str.length-num,result_str.length);
}

function btnRefreshOnClick() {
	if (xmlhttp==null) requestRoutes();
}

function btnCheckAllOnClick() {
	checkAll();
}

function chkAutorefreshOnChange(){
	var chk=document.getElementById("chkAutorefresh");
	autoRefresh=chk.checked;
	if (chk.checked) map.on('moveend',mapOnMoveend);
	else map.off('moveend',mapOnMoveend);
}

function activateRoute(route,popupCoord){
	var layer=route.layer;
	if (activeRoute!=null) 
		setRouteStyle(activeRoute,false);
	if (activeRoute!=null && activeRoute.osm_id==route.osm_id)	{
		activeRoute=null;
		map.closePopup();
	}
	else {
		activeRoute=route;
		setRouteStyle(route,true);
		openPopup(popupCoord,route.popupContent,"route",true);
	}
}

function setRouteStyle(route,active){
	if (route==null) return;
	var busstopStyle,routeStyle; 
	if (active){
		routeStyle=activeRouteStyle;
		busstopStyle=activeBusstopStyle;
	}
	else{
		routeStyle=defaultRouteStyle;
		busstopStyle=defaultBusstopStyle;
	}
	route.layer.setStyle(routeStyle);
	for (var i in route.stops) {
		route.stops[i].layer.setStyle(busstopStyle);
		if (!busstopsAllowed && active) map.addLayer(route.stops[i].layer);
		if (!busstopsAllowed && !active) map.removeLayer(route.stops[i].layer);
	}
	if (active) moveActiveRouteToFront();
	else if (busstopsAllowed) layerBusstops.bringToFront();
}

function routeOnClick(e){
	var layer=e.target;
	var popupCoord=e.latlng;
	var routeid=layer.feature.properties.osm_id;
	activateRoute(mapRoutes[routeid],popupCoord);
}

function popupRouteOnClick(e){
	var route_ind=e.target.attributes.value.value;
	var route=mapRoutes[route_ind];
	var popupCoord=openedPopupLatLng;
	activateRoute(route,popupCoord);
	if (activeRoute==null) activateRoute(route,popupCoord);
}

function listRouteOnClick(e){
	var route_id=e.target.value;
	var route=mapRoutes[route_id];
	var popupCoord=route.layer.getBounds().getCenter();
	map.setView(popupCoord,map.getZoom());
	activateRoute(route,popupCoord);
	if (activeRoute==null) activateRoute(route,popupCoord);
}

function activateBusstop(layer){
	var stopid=layer.feature.properties.osm_id;
	var stop=mapBusstops[stopid];
	activeBusstop=stop;
	openPopup(layer.getLatLng(),stop.popupContent,"busstop",true);
}

function openPopup(latlng,popupContent,type,autoPan){
	//console.debug("openPopup");
	var oldBounds=map.getBounds();
	map.closePopup();
	var popup = L.popup({autoPan:autoPan});
	openedPopupLatLng=latlng;
	openedPopupType=type;
	popup.setLatLng(latlng);
	popup.setContent(popupContent);
	map.openPopup(popup);
	//sync routes' checkboxes state
	if (openedPopupType=="busstop") 
		for (var i in activeBusstop.routes){
			var route=activeBusstop.routes[i];
			document.getElementById("popup_route_"+route.osm_id).checked=route.isVisible;	
		}
	if ( !oldBounds.equals(map.getBounds()) ) cancelNextMapMoveEvent=true; 
	//console.debug("\tsame bounds"+oldBounds.equals(map.getBounds()) );
}

function busstopOnClick(e){
	var layer=e.target;
	activateBusstop(layer);
}
function popupBusstopOnClick(e){
	var stopid=e.target.attributes.value.value;
	var layer=mapBusstops[stopid].layer;
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
	openedPopupLatLng=null;
	openedPopupType=null;
	//openedPopup=null;
}

function resizePage(){
	var height = 0;
	var width = 0;
	var listWidthPx=250;
	var listWidthPercents=0.25;
	var padding=10;
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
	var divControls=document.getElementById("divControls");
	var listWidth=Math.min(listWidthPx,width*listWidthPercents);
	divControls.style.width=listWidth+"px";
	controlsHeight=divControls.offsetHeight;
	divList.style.width=listWidth+"px";
	divList.style.height=(height-controlsHeight-padding*4)+"px";
	divList.style.top=(controlsHeight+1)+"px";
	divMap.style.width=(width-listWidth-padding*2)+"px";
	divMap.style.height=height+"px";
	divMap.style.left=(listWidth+padding*2+1)+"px";
}

function updatePopupContent(){
	//console.debug("updatePopupContent");
	if (openedPopupType==null) return;
	var activeObject=null;
	if (openedPopupType=="route") activeObject=activeRoute;
	if (openedPopupType=="busstop") activeObject=activeBusstop;
	if (activeObject==null){
		map.closePopup();
		return;
	}
	var content=activeObject.popupContent;
	openPopup(openedPopupLatLng,content,openedPopupType,false);
}

function docOnRoutesUpdateEnd(e){
	//console.debug("docOnRoutesUpdateEnd");
	updatePopupContent();
	//console.debug("end docOnRoutesUpdateEnd");
}
