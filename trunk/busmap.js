// busmap scripts
// author: gryphon
// license: WTFPL v.2


var map;
var routes;
var busstops;
var routeLayers=new Array();
var busstopLayers=new Array();
var xmlhttp;
var checkedCount=0;
var activeLayer=null;

var defaultOpacity=0.5;
var defaultWeight=5;
var activeOpacity=1;
var activeWeight=10;
var simplificationDistance=10.0;

function initmap() {
	// set up the map
	map = new L.Map('map');

	// create the tile layer with correct attribution
	var osmUrl='http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	var osmAttrib='Map data © OpenStreetMap contributors';
	var osm = new L.TileLayer(osmUrl, { minZoom: 1, maxZoom: 18, attribution: osmAttrib});		

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
	var color;
	num=parseInt(ref,10);
	if ( isNaN(num) || num < 1 ) 
		color="#"+Math.floor(Math.random()*0xffffff).toString(16);
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
		color="#"+Math.floor(1.0*a/b*0xffffff).toString(16);
		console.debug("color "+color+" "+num+" "+(a)+"/"+b);
	}
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
	arStops=new Array();
	//create array of the routes objects
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
			if (members[j].attributes.type.value=="node"){
				nodeid=members[j].attributes.ref.value;
				if (arStops[nodeid]==undefined) 
					arStops[nodeid]=new Array();
				arStops[nodeid].push(i);
			}
		}
		console.debug(tags["name"]);
		lines=mergeLines(lines);
		for ( var l in lines )
			lines[l]=simplifyLine(lines[l],simplificationDistance);
		routes[i]=new Object();
		routes[i].multiPolyline=lines;
		routes[i].name=tags["name"];
		routes[i].color=generateColorFromRef(tags["ref"]);
		routes[i].htmlDescription=getRouteDescriptionHTML(tags);
		routes[i].ref=tags["ref"];
		routes[i].stops=new Array();
	}
	//create array of the busstop objects
	busstops=new Array();
	for (var i in arStops){
		var stop=new Object();
		var tags=tagsToArray(nodesar[i].getElementsByTagName("tag"));
		stop.name=tags["name"];
		var lat=nodesar[i].attributes.lat.value;
		var lon=nodesar[i].attributes.lon.value;
		stop.latlon=new L.LatLng(lat,lon);
		stop.routes=new Array();
		stop.routesRefs=new Array();
		for (var j in arStops[i]){
			var r=arStops[i][j];
			var ref=routes[r].ref;
			stop.routes.push(routes[r]);
			routes[r].stops.push(stop);
			if (ref!=undefined) stop.routesRefs.push(ref);
		}
		stop.routesRefs=stop.routesRefs.filter(filterUnique);
		stop.routesRefs.sort(compareRefs);
		stop.visibleRoutes=0;
		busstops.push(stop);
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

//simplify the <line> by removing points that are closer then <dist>
//to the line without them
function simplifyLine(line,dist){
	if (line.length<3) return line;
	var p1=0;
	var p2=1;
	var simpline=new Array();
	simpline.push(line[p1]);
	while (p2<line.length-1){
		p3=p2+1;
		if ( distanceToLine(line[p1],line[p2],line[p3]) < dist ){
			p2++;
		}
		else {
			simpline.push(line[p2]);
			p1=p2++;
		}
	}
	simpline.push(line[p2]);
	//console.debug("simplify: before "+line.length+" after "+simpline.length);
	return simpline;
}

// distance from point to line 
// point end line ends are LanLng
function distanceToLine(p,lp1,lp2){
	var a=lp1.distanceTo(p);
	var b=lp2.distanceTo(p);
	var c=lp1.distanceTo(lp2);
	var dist_sqr=a*a - Math.pow( ( a*a - b*b + c*c ) / ( 2 * c ), 2 );
	return Math.sqrt(dist_sqr);
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
	while(busstopLayers.length>0) map.removeLayer(busstopLayers.pop());
	for (var i in routes){
		mpline=new L.MultiPolyline(routes[i].multiPolyline,
				{color:routes[i].color,opacity:defaultOpacity,weight:defaultWeight});
		//mpline.bindPopup(routes[i].name);
		mpline.on('click',routeOnClick);
		routeLayers[i]=mpline;
	}
	for (var i in busstops){
		//circle=new L.Circle(busstops[i].latlon,20);
		circle=new L.CircleMarker(busstops[i].latlon);
		strPopup="<h3>"+busstops[i].name+"</h3>";
		var first=true;
		for (ref in busstops[i].routesRefs){
			if (first) first=false;
			else strPopup+=", ";
			strPopup+=busstops[i].routesRefs[ref];
		}
		circle.bindPopup(strPopup);
		busstopLayers[i]=circle;
		busstops[i].layer=circle;
	}
}

function addLayers(){
	for (var i in routes){
		checkbox=document.getElementById("route"+i);
		if ( checkbox.checked && !map.hasLayer(routeLayers[i]) ){
			map.addLayer(routeLayers[i]);
			checkedCount++;
			for (var j in routes[i].stops){
				var stop=routes[i].stops[j];
				stop.visibleRoutes++;
				if (stop.visibleRoutes==1) map.addLayer(stop.layer);
			}
		}
		else if ( !checkbox.checked && map.hasLayer(routeLayers[i]) ){
			map.removeLayer(routeLayers[i]);
			checkedCount--;
			for (var j in routes[i].stops){
				var stop=routes[i].stops[j];
				stop.visibleRoutes--;
				if (stop.visibleRoutes==0) map.removeLayer(stop.layer);
			}
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
