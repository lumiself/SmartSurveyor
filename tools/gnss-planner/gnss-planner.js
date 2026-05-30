/* SmartSurveyor — GNSS Planner
 * ---------------------------------------------------------------------------
 * Live "is this a good spot?" check for a base/benchmark, using REAL orbital
 * data propagated to the current instant.
 *
 *   1. Fetch live TLEs from CelesTrak (GPS, GLONASS, Galileo, BeiDou).
 *   2. Propagate every satellite to "now" with SGP4 (satellite.js).
 *   3. Keep the ones above the elevation mask -> "satellites in view".
 *   4. From their az/el geometry, compute PDOP / HDOP / VDOP.
 *   5. Draw a polar sky plot + table, and read live fix accuracy from the
 *      Geolocation API.
 *
 * The web cannot read a receiver's tracked-satellite count, so this is the
 * honest, fully iOS-compatible answer: predicted-in-view + real fix health.
 * satellite.js does the SGP4 maths; everything else is plain JS.
 */
(function () {
  "use strict";

  /* ----------------------------------------------------------- constants */
  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  // CelesTrak GP API. Sends CORS `Access-Control-Allow-Origin: *`, so it is
  // fetchable straight from the browser (incl. iOS Safari) with no proxy.
  var CELESTRAK = "https://celestrak.org/NORAD/elements/gp.php";

  var CONSTELLATIONS = [
    { id: "gps",     name: "GPS",     group: "gps-ops", color: "#4ea1ff" },
    { id: "glonass", name: "GLONASS", group: "glo-ops", color: "#57c98a" },
    { id: "galileo", name: "Galileo", group: "galileo", color: "#f2a83d" },
    { id: "beidou",  name: "BeiDou",  group: "beidou",  color: "#e06b6b" },
  ];

  var TLE_CACHE_KEY = "ss_gnss_tle_v1";
  var SETTINGS_KEY = "ss_gnss_settings_v1";
  var TLE_FRESH_MS = 6 * 60 * 60 * 1000; // refetch in the background after 6h
  var RECOMPUTE_MS = 15 * 1000;          // live re-propagation cadence

  // satellite.js, loaded from CDN (with a fallback). The service worker caches
  // it after first online load so the engine survives going offline.
  var SAT_CDNS = [
    "https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js",
    "https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js",
  ];

  /* ------------------------------------------------------------- state */
  var state = {
    observer: null,        // { lat, lon, alt, source }
    mask: 10,              // elevation mask, degrees
    auto: true,
    enabled: {},           // { constellationId: bool }
    tle: {},               // { constellationId: [ {name, l1, l2} ] }
    tleFetchedAt: 0,
    recomputeTimer: null,
    geoWatchId: null,
    sats: [],              // last computed visible sats
  };
  CONSTELLATIONS.forEach(function (c) { state.enabled[c.id] = true; });

  /* ------------------------------------------------------------- helpers */
  function $(id) { return document.getElementById(id); }

  function setBanner(kind, html) {
    var b = $("banner");
    if (!html) { b.className = "banner"; b.innerHTML = ""; return; }
    b.className = "banner is-shown banner--" + kind;
    b.innerHTML = html;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.crossOrigin = "anonymous"; // request CORS so the SW can cache a real response
      s.onload = resolve;
      s.onerror = function () { reject(new Error("failed: " + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureSatelliteLib() {
    if (window.satellite) return Promise.resolve();
    return SAT_CDNS.reduce(function (chain, url) {
      return chain.catch(function () {
        return loadScript(url).then(function () {
          if (!window.satellite) throw new Error("loaded but no global");
        });
      });
    }, Promise.reject()).catch(function () {
      throw new Error("satellite.js unavailable");
    });
  }

  /* ----------------------------------------------------- settings persist */
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      if (typeof s.mask === "number") state.mask = s.mask;
      if (typeof s.auto === "boolean") state.auto = s.auto;
      if (s.enabled) CONSTELLATIONS.forEach(function (c) {
        if (typeof s.enabled[c.id] === "boolean") state.enabled[c.id] = s.enabled[c.id];
      });
      if (s.observer && isFinite(s.observer.lat) && isFinite(s.observer.lon)) {
        state.observer = { lat: s.observer.lat, lon: s.observer.lon,
          alt: s.observer.alt || 0, source: "manual" };
      }
    } catch (e) { /* ignore corrupt settings */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        mask: state.mask, auto: state.auto, enabled: state.enabled,
        observer: state.observer && { lat: state.observer.lat,
          lon: state.observer.lon, alt: state.observer.alt },
      }));
    } catch (e) { /* storage may be full/blocked — non-fatal */ }
  }

  /* ----------------------------------------------------- TLE: fetch/cache */
  function parseTle(text) {
    var out = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var name = (lines[i] || "").trim();
      var l1 = (lines[i + 1] || "").trim();
      var l2 = (lines[i + 2] || "").trim();
      if (l1.charAt(0) === "1" && l2.charAt(0) === "2") {
        out.push({ name: name || ("NORAD " + l1.slice(2, 7)), l1: l1, l2: l2 });
        i += 2;
      }
    }
    return out;
  }

  function readTleCache() {
    try {
      var c = JSON.parse(localStorage.getItem(TLE_CACHE_KEY) || "null");
      if (c && c.data && c.fetchedAt) { state.tle = c.data; state.tleFetchedAt = c.fetchedAt; return true; }
    } catch (e) { /* ignore */ }
    return false;
  }
  function writeTleCache() {
    try {
      localStorage.setItem(TLE_CACHE_KEY, JSON.stringify({
        fetchedAt: state.tleFetchedAt, data: state.tle }));
    } catch (e) { /* quota — non-fatal, just won't survive reload */ }
  }

  function fetchConstellation(c) {
    var url = CELESTRAK + "?GROUP=" + encodeURIComponent(c.group) + "&FORMAT=tle";
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(c.name + " HTTP " + r.status);
      return r.text();
    }).then(function (txt) {
      var sats = parseTle(txt);
      if (!sats.length) throw new Error(c.name + " returned no TLEs");
      return { id: c.id, sats: sats };
    });
  }

  function fetchAllTle() {
    setDataStatus("loading", "Fetching live orbital data…");
    return Promise.allSettled(CONSTELLATIONS.map(fetchConstellation))
      .then(function (results) {
        var got = 0, fresh = {};
        results.forEach(function (res, i) {
          var id = CONSTELLATIONS[i].id;
          if (res.status === "fulfilled") { fresh[id] = res.value.sats; got++; }
          else if (state.tle[id]) { fresh[id] = state.tle[id]; } // keep last good
        });
        if (got === 0) {
          // total failure — fall back to whatever was cached
          if (Object.keys(state.tle).length) {
            setBanner("warn", "Couldn't reach CelesTrak — showing the last orbital data saved on this device.");
            return false;
          }
          throw new Error("network");
        }
        state.tle = fresh;
        state.tleFetchedAt = Date.now();
        writeTleCache();
        if (got < CONSTELLATIONS.length) {
          setBanner("warn", "Loaded " + got + " of " + CONSTELLATIONS.length +
            " constellations — some feeds didn't respond.");
        } else {
          setBanner("", "");
        }
        return true;
      });
  }

  /* --------------------------------------------------------- computation */
  // 4x4 matrix inverse (Gauss-Jordan). Returns null if singular.
  function invert4(m) {
    var a = [], i, j;
    for (i = 0; i < 4; i++) a.push(m[i].slice().concat([0, 0, 0, 0]));
    for (i = 0; i < 4; i++) a[i][4 + i] = 1;
    for (i = 0; i < 4; i++) {
      var p = i;
      for (j = i + 1; j < 4; j++) if (Math.abs(a[j][i]) > Math.abs(a[p][i])) p = j;
      if (Math.abs(a[p][i]) < 1e-12) return null;
      var tmp = a[i]; a[i] = a[p]; a[p] = tmp;
      var piv = a[i][i];
      for (j = 0; j < 8; j++) a[i][j] /= piv;
      for (var k = 0; k < 4; k++) {
        if (k === i) continue;
        var f = a[k][i];
        for (j = 0; j < 8; j++) a[k][j] -= f * a[i][j];
      }
    }
    var inv = [];
    for (i = 0; i < 4; i++) inv.push(a[i].slice(4, 8));
    return inv;
  }

  // DOP from satellite az/el (radians). Needs >= 4 sats.
  function computeDop(sats) {
    if (sats.length < 4) return null;
    var N = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    for (var s = 0; s < sats.length; s++) {
      var el = sats[s].el, az = sats[s].az;
      var cE = Math.cos(el), sE = Math.sin(el);
      // Unit line-of-sight in local ENU; sign convention is irrelevant to DOP.
      var row = [-cE * Math.sin(az), -cE * Math.cos(az), -sE, 1];
      for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) N[i][j] += row[i] * row[j];
    }
    var Q = invert4(N);
    if (!Q) return null;
    return {
      gdop: Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2] + Q[3][3]),
      pdop: Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2]),
      hdop: Math.sqrt(Q[0][0] + Q[1][1]),
      vdop: Math.sqrt(Q[2][2]),
    };
  }

  function compute() {
    if (!state.observer || !window.satellite) return;
    var now = new Date();
    var gmst = satellite.gstime(now);
    var observerGd = {
      longitude: state.observer.lon * DEG,
      latitude: state.observer.lat * DEG,
      height: (state.observer.alt || 0) / 1000, // km
    };
    var maskRad = state.mask * DEG;
    var visible = [];
    var counts = {};
    CONSTELLATIONS.forEach(function (c) { counts[c.id] = 0; });

    CONSTELLATIONS.forEach(function (c) {
      if (!state.enabled[c.id]) return;
      var list = state.tle[c.id] || [];
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        try {
          var satrec = satellite.twoline2satrec(t.l1, t.l2);
          if (satrec.error) continue;
          var pv = satellite.propagate(satrec, now);
          if (!pv || !pv.position) continue;
          var ecf = satellite.eciToEcf(pv.position, gmst);
          var look = satellite.ecfToLookAngles(observerGd, ecf);
          if (look.elevation >= maskRad) {
            counts[c.id]++;
            visible.push({
              name: t.name, sys: c.id, color: c.color,
              az: look.azimuth, el: look.elevation,
            });
          }
        } catch (e) { /* skip a bad/decayed element */ }
      }
    });

    visible.sort(function (a, b) { return b.el - a.el; });
    state.sats = visible;
    render(visible, counts, computeDop(visible), now);
  }

  /* ------------------------------------------------------------ rendering */
  function dopQuality(v) {
    if (v == null) return { cls: "q-na", label: "" };
    if (v <= 2) return { cls: "q-excellent", label: "Excellent" };
    if (v <= 4) return { cls: "q-good", label: "Good" };
    if (v <= 6) return { cls: "q-moderate", label: "Moderate" };
    if (v <= 8) return { cls: "q-fair", label: "Fair" };
    return { cls: "q-poor", label: "Poor" };
  }

  function setStat(numId, qId, value) {
    var q = dopQuality(value);
    var n = $(numId);
    n.textContent = value == null ? "—" : value.toFixed(1);
    n.className = "stat__num " + q.cls;
    if (qId) {
      var qe = $(qId);
      qe.textContent = q.label || " ";
      qe.className = "stat__sub " + q.cls;
    }
  }

  function render(visible, counts, dop, now) {
    $("s-sats").textContent = visible.length;
    setStat("s-pdop", "s-pdop-q", dop && dop.pdop);
    setStat("s-hdop", "s-hdop-q", dop && dop.hdop);
    setStat("s-vdop", "s-vdop-q", dop && dop.vdop);
    if (visible.length < 4) {
      $("s-pdop-q").textContent = "need ≥ 4";
    }

    // constellation chips
    var wrap = $("consts");
    wrap.innerHTML = "";
    CONSTELLATIONS.forEach(function (c) {
      var on = state.enabled[c.id];
      var label = document.createElement("label");
      label.className = "const-chip" + (on ? "" : " is-off");
      label.innerHTML =
        '<input type="checkbox" ' + (on ? "checked" : "") + ' data-const="' + c.id + '">' +
        '<span class="swatch" style="background:' + c.color + '"></span>' +
        c.name + ' <span class="cnt">' + (counts[c.id] || 0) + "</span>";
      wrap.appendChild(label);
    });

    $("res-time").textContent = "as of " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    $("tab-count").textContent = visible.length;

    // table
    var tbody = $("sat-rows");
    if (!visible.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-faint);">No satellites above the mask.</td></tr>';
    } else {
      var rows = visible.map(function (s) {
        var sysName = CONSTELLATIONS.filter(function (c) { return c.id === s.sys; })[0].name;
        var azDeg = ((s.az * RAD) % 360 + 360) % 360;
        return "<tr><td><span class='sat-dot' style='background:" + s.color + "'></span>" +
          escapeHtml(s.name) + "</td><td>" + sysName + "</td><td class='num'>" +
          azDeg.toFixed(0) + "</td><td class='num'>" +
          (s.el * RAD).toFixed(0) + "</td></tr>";
      }).join("");
      tbody.innerHTML = rows;
    }

    drawSky(visible);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /* --------------------------------------------------------- sky plot */
  function drawSky(visible) {
    var canvas = $("sky");
    var dpr = window.devicePixelRatio || 1;
    var size = canvas.clientWidth || 360;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    var cx = size / 2, cy = size / 2;
    var R = size / 2 - 16;

    // mask ring (shaded "blocked" zone outside the mask elevation)
    var maskR = R * (90 - state.mask) / 90;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.arc(cx, cy, maskR, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(224,107,107,0.10)";
    ctx.fill("evenodd");

    // elevation rings: 0 (horizon), 30, 60
    ctx.strokeStyle = "rgba(159,176,189,0.25)";
    ctx.fillStyle = "#6f8290";
    ctx.font = "11px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.lineWidth = 1;
    [0, 30, 60].forEach(function (el) {
      var r = R * (90 - el) / 90;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(el + "°", cx + 3, cy - r + 12);
    });

    // azimuth spokes + N/E/S/W
    ctx.strokeStyle = "rgba(159,176,189,0.18)";
    for (var a = 0; a < 360; a += 30) {
      var rad = a * DEG;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.sin(rad), cy - R * Math.cos(rad));
      ctx.stroke();
    }
    ctx.fillStyle = "#9fb0bd";
    ctx.font = "bold 13px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var labels = [["N", 0], ["E", 90], ["S", 180], ["W", 270]];
    labels.forEach(function (l) {
      var rad = l[1] * DEG;
      ctx.fillText(l[0], cx + (R + 9) * Math.sin(rad), cy - (R + 9) * Math.cos(rad));
    });
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";

    // satellites
    visible.forEach(function (s) {
      var r = R * (90 - s.el * RAD) / 90;
      var x = cx + r * Math.sin(s.az);
      var y = cy - r * Math.cos(s.az);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.stroke();
    });
  }

  /* ----------------------------------------------------- status displays */
  function setDataStatus(kind, text) {
    var dot = $("data-dot");
    $("data-status").textContent = text;
    dot.classList.toggle("is-offline", kind !== "ok");
  }

  function relTime(ms) {
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " days ago";
  }
  function updateTleAge() {
    if (!state.tleFetchedAt) { $("tle-age").textContent = "—"; return; }
    var totalSats = 0;
    CONSTELLATIONS.forEach(function (c) { totalSats += (state.tle[c.id] || []).length; });
    $("tle-age").textContent = totalSats + " satellites · data " + relTime(state.tleFetchedAt);
    setDataStatus(navigator.onLine ? "ok" : "stale",
      navigator.onLine ? "Live orbital data" : "Offline · cached data");
  }

  /* --------------------------------------------------------- geolocation */
  function accuracyQuality(m) {
    if (m == null) return { cls: "q-na", label: "—" };
    if (m <= 3) return { cls: "q-excellent", label: "Excellent" };
    if (m <= 8) return { cls: "q-good", label: "Good" };
    if (m <= 15) return { cls: "q-moderate", label: "Fair" };
    if (m <= 40) return { cls: "q-fair", label: "Coarse" };
    return { cls: "q-poor", label: "Very coarse" };
  }

  function startGeolocation() {
    if (!("geolocation" in navigator)) {
      setBanner("warn", "This browser has no Geolocation API — enter a position manually.");
      return;
    }
    var btn = $("loc-btn"), label = $("loc-btn-label");
    label.innerHTML = '<span class="spin" aria-hidden="true"></span> Locating…';
    btn.disabled = true;

    if (state.geoWatchId != null) navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        btn.disabled = false;
        label.textContent = "Update location";
        var c = pos.coords;
        state.observer = { lat: c.latitude, lon: c.longitude,
          alt: c.altitude != null ? c.altitude : 0, source: "gps" };
        $("lat").value = c.latitude.toFixed(6);
        $("lon").value = c.longitude.toFixed(6);
        if (c.altitude != null) $("alt").value = c.altitude.toFixed(1);

        var acc = c.accuracy;
        var q = accuracyQuality(acc);
        var big = $("acc-big");
        big.textContent = acc != null ? "±" + acc.toFixed(1) + " m" : "—";
        big.className = "acc__big " + q.cls;
        var qe = $("acc-q"); qe.textContent = q.label; qe.className = q.cls;
        $("acc-pos").textContent = c.latitude.toFixed(5) + "°, " + c.longitude.toFixed(5) + "°";
        saveSettings();
        compute();
      },
      function (err) {
        btn.disabled = false;
        label.textContent = "Use my location";
        var msg = err.code === 1
          ? "Location permission denied — enter a position manually below."
          : "Couldn't get a location fix — enter a position manually below.";
        setBanner("warn", msg);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  /* --------------------------------------------------------- live loop */
  function startLoop() {
    stopLoop();
    if (!state.auto) return;
    state.recomputeTimer = setInterval(function () {
      updateTleAge();
      compute();
      // background refresh of stale orbital data while online
      if (navigator.onLine && Date.now() - state.tleFetchedAt > TLE_FRESH_MS) {
        fetchAllTle().then(function () { updateTleAge(); });
      }
    }, RECOMPUTE_MS);
  }
  function stopLoop() {
    if (state.recomputeTimer) { clearInterval(state.recomputeTimer); state.recomputeTimer = null; }
  }

  /* ------------------------------------------------------------- wiring */
  function wireUi() {
    $("mask").value = state.mask;
    $("mask-out").textContent = state.mask + "°";
    $("auto").checked = state.auto;
    if (state.observer) {
      $("lat").value = state.observer.lat;
      $("lon").value = state.observer.lon;
      $("alt").value = state.observer.alt || "";
    }

    $("loc-btn").addEventListener("click", startGeolocation);

    $("mask").addEventListener("input", function () {
      state.mask = parseInt(this.value, 10) || 0;
      $("mask-out").textContent = state.mask + "°";
      saveSettings();
      compute();
    });

    $("auto").addEventListener("change", function () {
      state.auto = this.checked;
      saveSettings();
      startLoop();
    });

    function readManual() {
      var lat = parseFloat($("lat").value), lon = parseFloat($("lon").value);
      var alt = parseFloat($("alt").value);
      if (isFinite(lat) && isFinite(lon)) {
        state.observer = { lat: lat, lon: lon, alt: isFinite(alt) ? alt : 0, source: "manual" };
        saveSettings();
        compute();
      }
    }
    ["lat", "lon", "alt"].forEach(function (id) {
      $(id).addEventListener("change", readManual);
    });

    $("refresh-btn").addEventListener("click", function () {
      var btn = this; btn.disabled = true; var prev = btn.textContent;
      btn.textContent = "Refreshing…";
      fetchAllTle().then(function () {
        updateTleAge(); compute();
      }).catch(function () {
        setBanner("err", "Couldn't fetch orbital data. Check your connection and try again.");
      }).finally(function () {
        btn.disabled = false; btn.textContent = prev;
      });
    });

    // constellation toggles (delegated — chips are re-rendered each compute)
    $("consts").addEventListener("change", function (e) {
      if (e.target && e.target.dataset && e.target.dataset.const) {
        state.enabled[e.target.dataset.const] = e.target.checked;
        saveSettings();
        compute();
      }
    });

    window.addEventListener("online", function () { updateTleAge();
      fetchAllTle().then(function () { updateTleAge(); compute(); }); });
    window.addEventListener("offline", updateTleAge);

    // top-of-page network dot mirrors the shared landing-page behaviour
    function netDot() {
      var d = $("net-dot");
      if (d) d.classList.toggle("is-offline", !navigator.onLine);
    }
    window.addEventListener("online", netDot);
    window.addEventListener("offline", netDot);
    netDot();

    // Keep the sky plot crisp when the layout reflows (rotate/resize).
    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { drawSky(state.sats); }, 150);
    });
  }

  /* --------------------------------------------------------------- init */
  function init() {
    loadSettings();
    wireUi();
    updateTleAge();

    // Default observer so the user sees something even before granting location.
    if (!state.observer) {
      state.observer = { lat: 0, lon: 0, alt: 0, source: "default" };
    }

    var haveCache = readTleCache();
    if (haveCache) { updateTleAge(); }

    ensureSatelliteLib().then(function () {
      // Engine is up. First paint from cache (instant), then refresh the data.
      if (haveCache) compute();
      startLoop(); // keep the live loop running even if the first fetch fails
      var needFetch = !haveCache || Date.now() - state.tleFetchedAt > TLE_FRESH_MS;
      var p = needFetch ? fetchAllTle() : Promise.resolve(true);
      return p.then(function () {
        updateTleAge();
        compute();
      }).catch(function () {
        // Engine works, but we have no orbital data yet (offline + no cache).
        setBanner("err", "Couldn't fetch orbital data from CelesTrak. " +
          "Connect to the internet, then tap “Refresh orbital data”.");
        setDataStatus("stale", "No orbital data");
      });
    }).catch(function () {
      setBanner("err", "Couldn't load the GNSS engine (satellite.js). " +
        "Connect to the internet and reload to compute live satellite positions.");
      setDataStatus("stale", "Engine unavailable");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
