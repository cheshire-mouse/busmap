// busmap scripts
// author: gryphon
// license: WTFPL v.2
// $Revision$
// $Date$


var map;
var routes;
var busstops;
var routeLayers=new Array();
var busstopLayers=new Array();
var xmlhttp=null;
var activeLayer=null;
var activeRouteOsmId=null;
var busstopsAllowed=true;

var visibleCount=0;
var visibleRoutes=new Array();
var allVisible=true;

var defaultOpacity=0.5;
var defaultWeight=5;
var activeOpacity=1;
var activeWeight=10;

function initmap() {
	// set up the map
	map = new L.Map('map');

	// create the tile layer with correct attribution
	var osmUrl='http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	//var osmUrl="http://{s}.www.toolserver.org/tiles/bw-mapnik/{z}/{x}/{y}.png";
	var osmAttrib='Map data © OpenStreetMap contributors';
	var osm = new L.TileLayer(osmUrl, { minZoom: 1, maxZoom: 18, attribution: osmAttrib});		

	//map.setView(new L.LatLng(0, 0),1);
	map.locate({setView:true});
	map.addLayer(osm);
	chkAllowStopsOnChange();
	chkAutorefreshOnChange();
}

function getRouteDescriptionHTML(objRoute){
	var fields=new Array();
	fields.push({id:"ref",name:"Номер"});
	fields.push({id:"from",name:"Откуда"});
	fields.push({id:"to",name:"Куда"});
	fields.push({id:"operator",name:"Владелец"});
	var description="";
	if (objRoute.name!=null) description +="<h3>"+objRoute.name+"</h3>";
	description+="<table>";
	for (var i in fields){
		if (objRoute[fields[i].id]!=null) 
			description +="<tr><td>"+fields[i].name+
				"</td><td>"+objRoute[fields[i].id]+"</td></tr>";
	}
	description+="</table>";
	return description;
}

function getBusstopPopupHTML(stop){
	var descr="";
	if (stop.name!=null)
		descr="<h3>"+stop.name+"</h3>";
	descr+="<div style=max-height:300px;overflow:auto>";
	for ( var i in stop.routes){
		var route_ind=stop.routes[i].index;
		var checked=stop.routes[i].isVisible?("checked"):("");
		if (i>0) descr+="<br>";
		descr+="<input type=checkbox "+checked+
				" value="+route_ind+
				" onchange=chkPopupOnChange(event) "+">"+
				"<span style=color:"+stop.routes[i].color+">\u2588 </span>";
		descr+=stop.routes[i].name;
	}
	descr+="</div>"
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
	var mapStops=new Array();
	for (var i in busstops){
		mapStops[busstops[i].osm_id]=busstops[i];
		busstops[i].routes=new Array();
		busstops[i].routesRefs=new Array();
		busstops[i].visibleRoutes=0;
	}

	routes=routesJson["routes"];
	
	for ( var i in routes ) routes[i].name=getRouteName(routes[i]);
	routes.sort(compareRoutes);
	
	visibleCount=0;
	if (allVisible) visibleRoutes=new Array();
	for ( var i in routes ) {
		routes[i].index=i;
		routes[i].htmlDescription=getRouteDescriptionHTML(routes[i]);
		if (routes[i].color==null)  routes[i].color=generateColorFromRef(routes[i].ref);
		if (routes[i].color==null)  routes[i].color=generateColorFromRef(routes[i].osm_id);
		if (visibleRoutes[routes[i].osm_id]==true || allVisible){			
			routes[i].isVisible=true;
			//newVisibleRoutes[routes[i].osm_id]=true;
			visibleRoutes[routes[i].osm_id]=visibleRoutes[routes[i].osm_id]||allVisible;
			visibleCount++;
		}
		routes[i].stops=new Array();
		var stops_ids=routes[i].stops_ids;
		for (var s in stops_ids){
			var s_id=stops_ids[s];
			var stop=mapStops[s_id];
			routes[i].stops.push(stop);
			stop.routes.push(routes[i]);
			if (routes[i].ref != null)
				stop.routesRefs.push(routes[i].ref);
		}
	}
	if (routes.length==0) {
		allVisible=true;
		visibleRoutes=new Array();
	}
/*
	for (var i in busstops){
		var stop=busstops[i];
		stop.routesRefs=stop.routesRefs.filter(filterUnique);
		stop.routesRefs.sort(compareRefs);
	}
*/
	createCheckboxes();
	generateLayers();
	addLayers();
	enableButtons();
	xmlhttp=null;
}


function requestRoutes() {
	var bbox=new Object();
	bbox.N=map.getBounds().getNorthEast().lat;
	bbox.E=(map.getBounds()).getNorthEast().lng;
	bbox.S=map.getBounds().getSouthWest().lat;
	bbox.W=map.getBounds().getSouthWest().lng;
	strBbox=""+bbox.S+","+bbox.W+","+bbox.N+","+bbox.E;
	console.debug(strBbox);
	if (window.XMLHttpRequest) {
   		xmlhttp=new XMLHttpRequest();
	   }
 	else {
		return;
	}
	json_url='http://198.199.107.98/routes.py/getroutes?'+
		'bboxe='+bbox.E+'&bboxw='+bbox.W+'&bboxn='+bbox.N+'&bboxs='+bbox.S;
	xmlhttp.open("GET",json_url,true);
	xmlhttp.onreadystatechange=processJSON;
	xmlhttp.send(null);
	disableButtons();
}

function createCheckboxes(){
	td=document.getElementById("cellRoutesList");
	while (td.firstChild) td.removeChild(td.firstChild);
	
	for (var i in routes){
		var checkbox= document.createElement("input");
		checkbox.type="checkbox";
		checkbox.id="route"+i;
		checkbox.value=i;
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
	while(routeLayers.length>0) map.removeLayer(routeLayers.pop());
	while(busstopLayers.length>0) map.removeLayer(busstopLayers.pop());
	for (var i in routes){
		mpline=new L.MultiPolyline(routes[i].lines.coordinates,
				{color:routes[i].color,opacity:defaultOpacity,weight:defaultWeight});
		//mpline.bindPopup(routes[i].name);
		mpline.on('click',routeOnClick);
		routeLayers[i]=mpline;
		routes[i].layer=mpline;
		if (activeRouteOsmId==routes[i].osm_id){
			activeLayer=mpline;
			mpline.setStyle({opacity:activeOpacity,weight:activeWeight});
		}
	}
	for (var i in busstops){
		//circle=new L.Circle(busstops[i].latlon,20);
		var latlon=new L.LatLng(busstops[i].point.coordinates[0],
				busstops[i].point.coordinates[1]);
		circle=new L.CircleMarker(latlon,{opacity:0.25});
		//var strPopup=getBusstopDescriptionHTML(busstops[i]);
		//circle.bindPopup(strPopup);
		circle.on('click',busstopOnClick);
		busstopLayers[i]=circle;
		busstops[i].layer=circle;
	}
}

function addLayers(){
	for (var i in routes){
		checkbox=document.getElementById("route"+i);
		if ( routes[i].isVisible && !map.hasLayer(routes[i].layer) ){
			map.addLayer(routeLayers[i]);
			for (var j in routes[i].stops){
				var stop=routes[i].stops[j];
				stop.visibleRoutes++;
				if (stop.visibleRoutes==1 && busstopsAllowed) map.addLayer(stop.layer);
			}
		}
		else if ( !routes[i].isVisible && map.hasLayer(routes[i].layer) ){
			map.removeLayer(routeLayers[i]);
			for (var j in routes[i].stops){
				var stop=routes[i].stops[j];
				stop.visibleRoutes--;
				if (stop.visibleRoutes==0) map.removeLayer(stop.layer);
			}
		}
	}
	if (activeLayer!=null && map.hasLayer(activeLayer))
		activeLayer.bringToFront();
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

function disableButtons(){
	document.getElementById("btnRefresh").disabled=true;
}

function enableButtons(){
	document.getElementById("btnRefresh").disabled=false;
}

function checkOnChange(e){
	var r=e.target.value;
	var isChecked=e.target.checked;
	routes[r].isVisible=isChecked;
	visibleRoutes[routes[r].osm_id]=isChecked;
	if (isChecked) visibleCount++;
	else visibleCount--;
	allVisible=(visibleCount==routes.length);
	addLayers();
}

function chkPopupOnChange(e){
	document.getElementById("route"+e.target.value).checked=e.target.checked;
	checkOnChange(e);
}

function chkAllowStopsOnChange(){
	var chk=document.getElementById("chkAllowStops")
	busstopsAllowed=chk.checked;
	if ( busstopsAllowed ) addAllBusstopLayers();
	else  removeAllBusstopLayers();
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
	var chk=document.getElementById("chkAutorefresh")
	if (chk.checked) map.on('moveend',mapOnMoveend);
	else map.off('moveend',mapOnMoveend);
	console.debug(chk.checked);
}

function routeOnClick(e){
	var layer=e.target;
	layer.bringToFront();
	if (activeLayer!=null) 
		activeLayer.setStyle({opacity:defaultOpacity,weight:defaultWeight});
	if (activeLayer==layer)	{
		activeLayer=null;
		activeRouteOsmId=null;
		map.closePopup();
	}
	else {
		layer.setStyle({opacity:activeOpacity,weight:activeWeight});
		activeLayer=layer;
		routeid=routeLayers.indexOf(layer);
		var popup = L.popup();
		popup.setLatLng(e.latlng);
		popup.setContent(routes[routeid].htmlDescription);
		activeRouteOsmId=routes[routeid].osm_id;
		map.openPopup(popup);
	}
}

function busstopOnClick(e){
	var layer=e.target;
	var stopid=busstopLayers.indexOf(layer);
	var stop=busstops[stopid];
	var popup = L.popup();
	popup.setLatLng(e.latlng);
    popup.setContent(getBusstopPopupHTML(stop));
	map.openPopup(popup);
}


function mapOnMoveend(e){
	if (xmlhttp==null) requestRoutes();
}
