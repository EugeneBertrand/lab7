import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@3.1.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiZXNiZXJ0cmFuZCIsImEiOiJjbXdiZTJ3a3QwMDVuMnlwem01MWtiOXh1In0.4bPEMT6EOL8sh_5Hr4Q4AA';

if (!document.querySelector('#map svg')) {
  d3.select('#map').append('svg');
}

const svg = d3.select('#map').select('svg');
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 11.5,
  minZoom: 9,
  maxZoom: 18,
});

let stations = [];
let trips = [];
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
const radiusScale = d3.scaleSqrt().domain([0, 1]).range([0, 25]);

function getCoords(station) {
  const point = new mapboxgl.LngLat(Number(station.lon), Number(station.lat));
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function updatePositions() {
  svg.selectAll('circle').attr('cx', (d) => getCoords(d).cx).attr('cy', (d) => getCoords(d).cy);
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function filterByMinute(bucket, minute) {
  if (minute === -1) {
    return bucket.flat();
  }

  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;

  if (minMinute <= maxMinute) {
    return bucket.slice(minMinute, maxMinute + 1).flat();
  }

  return bucket.slice(minMinute).concat(bucket.slice(0, maxMinute + 1)).flat();
}

function computeStationTraffic(currentStations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (values) => values.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (values) => values.length,
    (d) => d.end_station_id,
  );

  return currentStations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function updateScatterPlot(timeFilter = -1) {
  const currentStations = computeStationTraffic(stations, timeFilter);
  radiusScale.domain([0, d3.max(currentStations, (d) => d.totalTraffic) || 1]).range(timeFilter === -1 ? [0, 25] : [3, 50]);

  const circles = svg
    .selectAll('circle')
    .data(currentStations, (d) => d.short_name)
    .join('circle')
    .attr('cx', (d) => getCoords(d).cx)
    .attr('cy', (d) => getCoords(d).cy)
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) => stationFlow(d.departures / (d.totalTraffic || 1)));

  circles.each(function (d) {
    d3.select(this)
      .selectAll('title')
      .data([d])
      .join('title')
      .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
  });
}

function updateTimeDisplay() {
  const timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'inline';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  updateScatterPlot(timeFilter);
}

map.on('load', async () => {
    const bikeLaneStyle = {
      'line-color': '#32a852',
      'line-width': 3,
      'line-opacity': 0.65,
    };
    map.addSource('boston-bike-lanes', {
      type: 'geojson',
      data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });
    map.addLayer({
      id: 'boston-bike-lanes',
      type: 'line',
      source: 'boston-bike-lanes',
      paint: bikeLaneStyle,
    });
    map.addSource('cambridge-bike-lanes', {
      type: 'geojson',
      data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });
    map.addLayer({
      id: 'cambridge-bike-lanes',
      type: 'line',
      source: 'cambridge-bike-lanes',
      paint: bikeLaneStyle,
    });

    const stationResponse = await fetch('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
    const stationData = await stationResponse.json();
    stations = stationData.data.stations;

    const trafficResponse = await fetch('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv');
    const trafficText = await trafficResponse.text();
    trips = d3.csvParse(trafficText, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });

    trips.forEach((trip) => {
      const startMinute = minutesSinceMidnight(trip.started_at);
      const endMinute = minutesSinceMidnight(trip.ended_at);
      departuresByMinute[startMinute].push(trip);
      arrivalsByMinute[endMinute].push(trip);
    });

    updateScatterPlot(-1);
    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
});

map.on('style.load', () => {
  const svgRoot = d3.select('#map').select('svg');
  if (svgRoot.empty()) {
    d3.select('#map').append('svg');
  }
});
