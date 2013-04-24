// busmap scripts
// author: gryphon
// license: WTFPL v.2


var map;
var routes;
var routeLayers=new Array();
var xmlhttp;
var checkedCount=0;
var activeLayer=null;

var defaultOpacity=0.5;
var defaultWeight=5;
var activeOpacity=1;
var activeWeight=10;

function initmap() {
	// set up the map
	map = new L.Map('map');

	// create the tile layer with correct attribution
	var osmUrl='http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	var osmAttrib='Map data © OpenStreetMap contributors';
	var osm = new L.TileLayer(osmUrl, {opacity: 0.5, minZoom: 1, maxZoom: 18, attribution: osmAttrib});		

	//map.setView(new L.LatLng(0, 0),1);
	map.locate({setView:true});
	map.addLayer(osm);

}

function tagsToArray(nlTags){
	var tags=new Array();
	for (var i=0;i<nlTags.length;i++){
		key=nlTags[i].attributes.k.value;
		value=nlTags[i].attributes.v.value;
		//console.debug(key+" "+value);
		tags[key]=value;
	}
	return tags;
}

function getRouteDescriptionHTML(arTags){
	var fields=new Array();
	fields.push({id:"ref",name:"Номер"});
	fields.push({id:"from",name:"Откуда"});
	fields.push({id:"to",name:"Куда"});
	fields.push({id:"operator",name:"Владелец"});
	var description="";
	if (arTags["name"]!=null) description +="<h3>"+arTags["name"]+"</h3>";
	description+="<table>";
	for (var i in fields){
		if (arTags[fields[i].id]!=null) 
			description +="<tr><td>"+fields[i].name+
				"</td><td>"+arTags[fields[i].id]+"</td></tr>";
	}
	description+="</table>";
	return description;
}

function generateColorFromRef(ref){
	color="#"+Math.floor(Math.random()*0xffffff).toString(16);
	console.debug("gencolor "+color);

	return color;
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
	for (var i=0;i<nodeslist.length;i++)	nodesar[nodeslist[i].attributes.id.value]=nodeslist[i];
	wayslist=xmlDoc.getElementsByTagName("way");
	var waysar=new Array();
	for (var i=0;i<wayslist.length;i++) waysar[wayslist[i].attributes.id.value]=wayslist[i];
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
		console.debug(tags["name"]);
		routes[i]=new Object();
		routes[i].multiPolyline=mergeLines(lines);
		routes[i].name=tags["name"];
		routes[i].color=generateColorFromRef(tags["ref"]);
		routes[i].htmlDescription=getRouteDescriptionHTML(tags);
	}
	routes.sort(compareRoutes);
	createCheckboxes();
	generateLayers();
	addLayers();
	enableButtons();
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
		if ( ar1first.equals(ar2first) ) arLines[i].reverse();
		else if ( ar1last.equals(ar2last) ) arLines[i+1].reverse();
		else if ( ar1first.equals(ar2last) ) {
			arLines[i].reverse();
			arLines[i+1].reverse();
		}
		ar2first=arLines[i+1][0];
		ar1last=arLines[i][arLines[i].length-1];
		if (ar2first.equals(ar1last)){
			arLines[i].pop();
			arLines[i+1]=arLines[i].concat(arLines[i+1]);
		}
		else arMergedLines.push(arLines[i]);
	}
	arMergedLines.push(arLines[arLines.length-1]);
	//console.debug("mergeLines, out: "+arMergedLines.length);
	return arMergedLines;
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

function generateLayers(){
	while(routeLayers.length>0) map.removeLayer(routeLayers.pop());
	for (var i in routes){
		mpline=new L.MultiPolyline(routes[i].multiPolyline,
				{color:routes[i].color,opacity:defaultOpacity,weight:defaultWeight});
		//mpline.bindPopup(routes[i].name);
		mpline.on('click',routeOnClick);
		routeLayers[i]=mpline;
	}
}

function addLayers(){
	for (var i in routes){
		checkbox=document.getElementById("route"+i);
		if ( checkbox.checked && !map.hasLayer(routeLayers[i]) ){
			map.addLayer(routeLayers[i]);
			checkedCount++;
		}
		else if ( !checkbox.checked && map.hasLayer(routeLayers[i]) ){
			map.removeLayer(routeLayers[i]);
			checkedCount--;
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
	addLayers();
}

function checkAll(){
	//nlInput=document.getElementsByTagName("input");
	for (var i=0; i<routes.length;i++){
		chk=document.getElementById("route"+i);
		chk.checked=(checkedCount<routes.length);
	}
}

function compareRoutes(a,b){
	if (a.name < b.name)
		return -1;
	if (a.name > b.name)
		return 1;
	return 0;
}

function btnRefreshOnClick() {
	requestRoutes();
}

function btnCheckAllOnClick() {
	checkAll();
	addLayers();
}

function routeOnClick(e){
	var layer=e.target;
	layer.bringToFront();
	if (activeLayer!=null) 
		activeLayer.setStyle({opacity:defaultOpacity,weight:defaultWeight});
	if (activeLayer==layer)	{
		activeLayer=null;
		map.closePopup();
	}
	else {
		layer.setStyle({opacity:activeOpacity,weight:activeWeight});
		activeLayer=layer;
		routeid=routeLayers.indexOf(layer);
		var popup = L.popup();
		popup.setLatLng(e.latlng);
	        popup.setContent(routes[routeid].htmlDescription);
		map.openPopup(popup);
	}
}
