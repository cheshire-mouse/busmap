// busmap scripts
// author: gryphon
// license: WTFPL v.2


var map;
var routes;
var routeLayers=new Array();
var xmlhttp;

function initmap() {
	// set up the map
	map = new L.Map('map');

	// create the tile layer with correct attribution
	var osmUrl='http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	var osmAttrib='Map data © OpenStreetMap contributors';
	var osm = new L.TileLayer(osmUrl, {minZoom: 1, maxZoom: 18, attribution: osmAttrib});		

	//map.setView(new L.LatLng(0, 0),1);
	map.locate({setView:true});
	map.addLayer(osm);

}

function tagsToArray(nlTags){
	var tags=new Array();
	for (var i=0;i<nlTags.length;i++){
		key=nlTags[i].attributes.k.value;
		value=nlTags[i].attributes.v.value;
		console.debug(key+" "+value);
		tags[key]=value;
	}
	return tags;
}

function getRouteDescriptionHTML(arTags){
	return "toDo";
}

function generateColorFromRef(ref){
	return "green";
}

function requestRoutes() {
	var bbox=new Object();
	bbox.N=map.getBounds().getNorthEast().lat;
	bbox.E=(map.getBounds()).getNorthEast().lng;
	bbox.S=map.getBounds().getSouthWest().lat;
	bbox.W=map.getBounds().getSouthWest().lng;
	strBbox=""+bbox.S+","+bbox.W+","+bbox.N+","+bbox.E;
	console.debug(strBbox);
	if (window.XMLHttpRequest)
	   {// code for IE7+, Firefox, Chrome, Opera, Safari
   		xmlhttp=new XMLHttpRequest();
	   }
 	else
	   {// code for IE6, IE5
	   xmlhttp=new ActiveXObject("Microsoft.XMLHTTP");
	   }
	overpass_url='http://overpass.osm.rambler.ru/cgi/interpreter?data=relation[type=route][route=bus]('+strBbox+');(._;>);out meta;'
	xmlhttp.open("GET",overpass_url,true);
	xmlhttp.onreadystatechange=processOSMData;
	xmlhttp.send();
	disableButtons();
	//xmlText=xmlhttp.responseText;
}

function processOSMData(){
	if (xmlhttp.readyState != 4) return;
	if (xmlhttp.status != 200){
		alert(xmlhttp.status+" "+xmlhttp.statusText);
		enableButtons();
		return;
	}

	var xmlDoc=xmlhttp.responseXML;
	nodeslist=xmlDoc.getElementsByTagName("node");
	var nodesar=new Array();
	for (var i=0;i<nodeslist.length;i++)	nodesar[nodeslist[i].id]=nodeslist[i];
	wayslist=xmlDoc.getElementsByTagName("way");
	var waysar=new Array();
	for (var i=0;i<wayslist.length;i++)	waysar[wayslist[i].id]=wayslist[i];
	rels=xmlDoc.getElementsByTagName("relation");
	routes=new Array();
	for (var i=0;i<rels.length;i++){
		tags=tagsToArray(rels[i].getElementsByTagName("tag"));
		var lines=new Array();
		members=rels[i].getElementsByTagName("member");
		for (var j=0;j<members.length;j++){
			if (members[j].attributes.type.value=="way"){
				wayid=members[j].attributes.ref.value;
				nds=waysar[wayid].getElementsByTagName("nd");
				lines.push(new Array());
				for (k=0;k<nds.length;k++){
					nodeid=nds[k].attributes.ref.value;
					lat=nodesar[nodeid].attributes.lat.value;
					lon=nodesar[nodeid].attributes.lon.value;
					lines[lines.length-1].push(new L.LatLng(lat, lon));
				}
			}
		}
		routes[i]=new Object();
		routes[i].multiPolyline=lines;
		routes[i].name=tags["name"];
		routes[i].color=generateColorFromRef(tags["ref"]);
		routes[i].htmlDescription=getRouteDescriptionHTML(tags);
	}
	createCheckboxes();
	createLayers();
	enableButtons();
}

function createCheckboxes(){
	td=document.getElementById("cellRoutesList");
	while (td.firstChild) td.removeChild(td.firstChild);
	
	for (var i in routes){
		var checkbox= document.createElement("input");
		checkbox.type="checkbox";
		checkbox.id="route"+i;
		checkbox.checked=true;
		checkbox.addEventListener("change",checkOnChange);
		text=document.createTextNode(routes[i].name);
		br=document.createElement('br');
		td.appendChild(checkbox);
		td.appendChild(text);
		td.appendChild(br);
	}
}

function createLayers(){
	while(routeLayers.length>0) map.removeLayer(routeLayers.pop());
	for (var i in routes){
		checkbox=document.getElementById("route"+i);
		if (checkbox.checked){
			mpline=new L.MultiPolyline(routes[i].multiPolyline,{color:routes[i].color});
			mpline.bindPopup(routes[i].name);
			map.addLayer(mpline);
			routeLayers.push(mpline);
		}
	}
}

function disableButtons(){
	document.getElementById("btnRefresh").disabled=true;
}

function enableButtons(){
	document.getElementById("btnRefresh").disabled=false;
}

function checkOnChange(){
	createLayers();
}

function btnRefreshOnClick() {
	requestRoutes();
}

