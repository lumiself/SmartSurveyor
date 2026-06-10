(function () {
  "use strict";

  /* ---------- constants ---------- */
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const $ = (id) => document.getElementById(id);

  /* ---------- geodesy (mirrors the coordinate converter) ----------
     Used only for the "Use GPS" helper: device WGS84 lat/lon -> Nahrwan
     1967 UTM (Clarke 1880, 3-parameter Helmert shift, UAE values). */
  function ellipsoid(a, invF) {
    const f = 1 / invF;
    const e2 = f * (2 - f);
    return { a: a, f: f, e2: e2, ep2: e2 / (1 - e2) };
  }
  const WGS84 = ellipsoid(6378137.0, 298.257223563);
  const CLARKE = ellipsoid(6378249.145, 293.465); // Clarke 1880 (RGS)
  const DX = -249, DY = -156, DZ = 381;            // Zone 39 (EPSG:1191)
  const AS = Math.PI / (180 * 3600);
  const SH40 = { dx: -225.4, dy: -158.7, dz: 380.8, rx: 0, ry: 0, rz: 0.814 * AS, s: -0.38e-6 };

  function geoToEcef(latDeg, lonDeg, h, el) {
    const phi = latDeg * D2R, lam = lonDeg * D2R;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const N = el.a / Math.sqrt(1 - el.e2 * sp * sp);
    return {
      x: (N + h) * cp * Math.cos(lam),
      y: (N + h) * cp * Math.sin(lam),
      z: (N * (1 - el.e2) + h) * sp
    };
  }

  function ecefToGeo(p, el) {
    const a = el.a, e2 = el.e2;
    const lon = Math.atan2(p.y, p.x);
    const r = Math.hypot(p.x, p.y);
    let lat = Math.atan2(p.z, r * (1 - e2));
    for (let i = 0; i < 8; i++) {
      const s = Math.sin(lat);
      const N = a / Math.sqrt(1 - e2 * s * s);
      lat = Math.atan2(p.z + e2 * N * s, r);
    }
    return { lat: lat * R2D, lon: lon * R2D };
  }

  function geoToUtm(latDeg, lonDeg, el, zone) {
    const a = el.a, e2 = el.e2, ep2 = el.ep2, k0 = 0.9996;
    const e4 = e2 * e2, e6 = e4 * e2;
    const lon0 = (zone * 6 - 183) * D2R;
    const phi = latDeg * D2R, lam = lonDeg * D2R;
    const sp = Math.sin(phi), cp = Math.cos(phi), tp = Math.tan(phi);
    const N = a / Math.sqrt(1 - e2 * sp * sp);
    const T = tp * tp;
    const C = ep2 * cp * cp;
    const A = (lam - lon0) * cp;
    const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
      - (35 * e6 / 3072) * Math.sin(6 * phi));
    const E = 500000 + k0 * N * (A
      + (1 - T + C) * A * A * A / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120);
    const Nn = k0 * (M + N * tp * (A * A / 2
      + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
    return { E: E, N: Nn };
  }

  function wgs84ToNahrwanUtm(latDeg, lonDeg, zone) {
    const ecef = geoToEcef(latDeg, lonDeg, 0, WGS84);
    let nahEcef;
    if (zone === 40) {
      const s = SH40.s;
      nahEcef = {
        x: -SH40.dx + (1 - s) * ecef.x + SH40.rz * ecef.y - SH40.ry * ecef.z,
        y: -SH40.dy - SH40.rz * ecef.x + (1 - s) * ecef.y + SH40.rx * ecef.z,
        z: -SH40.dz + SH40.ry * ecef.x - SH40.rx * ecef.y + (1 - s) * ecef.z
      };
    } else {
      nahEcef = { x: ecef.x - DX, y: ecef.y - DY, z: ecef.z - DZ };
    }
    const g = ecefToGeo(nahEcef, CLARKE);
    return geoToUtm(g.lat, g.lon, CLARKE, zone);
  }

  /* ---------- planar (grid) vector math ---------- */
  function vector(fE, fN, fH, tE, tN, tH) {
    const dE = tE - fE, dN = tN - fN;
    const dH = (isFinite(fH) && isFinite(tH)) ? (tH - fH) : NaN;
    const horiz = Math.hypot(dE, dN);
    let az = Math.atan2(dE, dN) * R2D;
    if (az < 0) az += 360;
    const out = { dE: dE, dN: dN, dH: dH, horiz: horiz, az: az };
    if (isFinite(dH)) {
      out.slope = Math.hypot(horiz, dH);
      out.vAngle = Math.atan2(dH, horiz) * R2D; // + up, - down
      out.zenith = 90 - out.vAngle;
    }
    return out;
  }

  function toDms(value) {
    let v = Math.abs(value);
    let d = Math.floor(v);
    let mf = (v - d) * 60;
    let m = Math.floor(mf);
    let s = (mf - m) * 60;
    if (s >= 59.95) { s = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    return d + "° " + String(m).padStart(2, "0") + "' " + s.toFixed(1) + "\"";
  }

  const num = (id) => parseFloat($(id).value);
  const setArrow = (el, deg) => { el.style.transform = "rotate(" + deg + "deg)"; };

  /* ---------- state ---------- */
  let heading = null;       // device compass heading (deg), or null
  let compassOn = false;
  let gotReading = false;   // have we received at least one orientation event?

  /* ---------- persistence ---------- */
  const STORE = "ss-navigator";
  const FIELDS = [
    "nav-from-e", "nav-from-n", "nav-from-h", "nav-to-e", "nav-to-n", "nav-to-h", "nav-zone",
    "st-occ-e", "st-occ-n", "st-occ-h", "st-ref-e", "st-ref-n", "st-ref-h"
  ];
  function save() {
    try {
      const data = { mode: currentMode() };
      FIELDS.forEach((f) => { data[f] = $(f).value; });
      localStorage.setItem(STORE, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE) || "{}");
      FIELDS.forEach((f) => { if (data[f] != null) $(f).value = data[f]; });
      if (data.mode) {
        const r = document.querySelector('input[name="navMode"][value="' + data.mode + '"]');
        if (r) r.checked = true;
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- mode ---------- */
  function currentMode() {
    const r = document.querySelector('input[name="navMode"]:checked');
    return r ? r.value : "navigate";
  }
  function applyMode() {
    const m = currentMode();
    $("panel-navigate").hidden = m !== "navigate";
    $("panel-station").hidden = m !== "station";
    recompute();
  }

  /* ---------- navigate mode ---------- */
  function updateNavigate() {
    const fE = num("nav-from-e"), fN = num("nav-from-n"), fH = num("nav-from-h");
    const tE = num("nav-to-e"), tN = num("nav-to-n"), tH = num("nav-to-h");
    const ready = [fE, fN, tE, tN].every(isFinite);
    if (!ready) {
      $("nav-distance").textContent = "—";
      $("nav-bearing").textContent = "—";
      $("nav-slope").textContent = "—";
      $("nav-turn").textContent = "Enter both points";
      return;
    }
    const v = vector(fE, fN, fH, tE, tN, tH);
    $("nav-distance").textContent = v.horiz.toFixed(2) + " m";
    $("nav-bearing").textContent = v.az.toFixed(2) + "°  (" + toDms(v.az) + ")";
    $("nav-slope").textContent = isFinite(v.slope)
      ? v.slope.toFixed(2) + " m  (Δh " + v.dH.toFixed(2) + " m)"
      : "—";

    let arrowDeg = v.az;
    if (compassOn && heading != null) {
      arrowDeg = v.az - heading;
      const rel = ((v.az - heading) % 360 + 360) % 360;
      if (rel < 2 || rel > 358) $("nav-turn").textContent = "✔ On target";
      else if (rel <= 180) $("nav-turn").textContent = "Turn right " + rel.toFixed(0) + "°";
      else $("nav-turn").textContent = "Turn left " + (360 - rel).toFixed(0) + "°";
    } else {
      $("nav-turn").textContent = "Map is grid-north up ↑";
    }
    setArrow($("nav-arrow"), arrowDeg);
  }

  /* ---------- station orientation mode ---------- */
  function updateStation() {
    const oE = num("st-occ-e"), oN = num("st-occ-n"), oH = num("st-occ-h");
    const rE = num("st-ref-e"), rN = num("st-ref-n"), rH = num("st-ref-h");
    const ready = [oE, oN, rE, rN].every(isFinite);
    if (!ready) {
      $("st-az-dec").textContent = "—";
      $("st-az-dms").textContent = "—";
      $("st-horiz").textContent = "—";
      $("st-vert-block").hidden = true;
      $("st-hint").textContent = "Enter station and reference points";
      return;
    }
    const v = vector(oE, oN, oH, rE, rN, rH);
    $("st-az-dec").textContent = v.az.toFixed(4) + "°";
    $("st-az-dms").textContent = toDms(v.az);
    $("st-horiz").textContent = v.horiz.toFixed(3) + " m";
    setArrow($("st-arrow"), v.az);
    $("st-hint").textContent = "Aim the instrument along the arrow, set the horizontal circle to the azimuth above.";

    if (isFinite(v.vAngle)) {
      $("st-vert-block").hidden = false;
      $("st-vangle").textContent = (v.vAngle >= 0 ? "+" : "") + v.vAngle.toFixed(4) + "°";
      $("st-zenith").textContent = v.zenith.toFixed(4) + "°";
      $("st-slope").textContent = v.slope.toFixed(3) + " m";
      // tilt arrow: point up for positive vertical angle, down for negative
      setArrow($("st-vert-arrow"), v.vAngle >= 0 ? 0 : 180);
      $("st-tilt-label").textContent = v.vAngle >= 0 ? "Tilt up" : "Tilt down";
    } else {
      $("st-vert-block").hidden = true;
    }
  }

  function recompute() {
    if (currentMode() === "navigate") updateNavigate();
    else updateStation();
    save();
  }

  /* ---------- device sensors ---------- */
  function status(msg) { $("nav-msg").textContent = msg || ""; }

  function useGps() {
    if (!navigator.geolocation) { status("Geolocation not supported on this device."); return; }
    status("Locating…");
    $("nav-gps").disabled = true;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const zone = parseInt($("nav-zone").value, 10) || 40;
        const u = wgs84ToNahrwanUtm(p.coords.latitude, p.coords.longitude, zone);
        $("nav-from-e").value = u.E.toFixed(2);
        $("nav-from-n").value = u.N.toFixed(2);
        if (p.coords.altitude != null && isFinite(p.coords.altitude)) {
          $("nav-from-h").value = p.coords.altitude.toFixed(2);
        }
        const acc = p.coords.accuracy != null ? " (±" + Math.round(p.coords.accuracy) + " m)" : "";
        status("Position set from GPS – zone " + zone + "N" + acc);
        $("nav-gps").disabled = false;
        recompute();
      },
      (err) => {
        status("GPS error: " + err.message);
        $("nav-gps").disabled = false;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // Current screen rotation (deg). deviceorientation alpha is reported relative
  // to the device's natural orientation, so we add this back to keep the arrow
  // correct when the phone is rotated to landscape.
  function screenAngle() {
    if (screen.orientation && screen.orientation.angle != null) return screen.orientation.angle;
    if (window.orientation != null) return window.orientation;
    return 0;
  }

  function onOrient(e) {
    let h = null;
    if (e.webkitCompassHeading != null) {
      h = e.webkitCompassHeading;                          // iOS: already a true heading
    } else if (e.alpha != null) {
      // Android/others. Treat alpha as a compass heading; absolute when the
      // event provides it, best-effort otherwise (still tracks turning).
      h = (360 - e.alpha + screenAngle()) % 360;
    }
    if (h == null || isNaN(h)) return;
    heading = (h + 360) % 360;
    gotReading = true;
    if (currentMode() === "navigate") updateNavigate();
  }

  function enableCompass() {
    function start() {
      window.addEventListener("deviceorientationabsolute", onOrient, true);
      window.addEventListener("deviceorientation", onOrient, true);
      compassOn = true;
      gotReading = false;
      $("nav-compass-btn").textContent = "Compass on";
      $("nav-compass-btn").disabled = true;
      updateNavigate();
      // If no sensor event arrives shortly, the device has no magnetometer
      // (or blocked it) — tell the user instead of leaving a frozen arrow.
      setTimeout(function () {
        if (compassOn && !gotReading) {
          status("No compass readings — this device may lack a magnetometer. Arrow stays grid-north up.");
        }
      }, 1500);
    }
    if (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission()
        .then((s) => { if (s === "granted") start(); else status("Compass permission denied."); })
        .catch(() => status("Compass unavailable."));
    } else if (typeof DeviceOrientationEvent !== "undefined") {
      start();
    } else {
      status("This device/browser doesn't expose orientation sensors.");
    }
  }

  /* ---------- init ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    load();

    document.querySelectorAll('input[name="navMode"]').forEach((r) =>
      r.addEventListener("change", applyMode));

    FIELDS.forEach((f) => {
      const el = $(f);
      el.addEventListener("input", recompute);
      el.addEventListener("change", recompute);
    });

    $("nav-gps").addEventListener("click", useGps);
    $("nav-compass-btn").addEventListener("click", enableCompass);

    document.querySelectorAll("[data-swap]").forEach((btn) =>
      btn.addEventListener("click", function () { swapPoints(this.getAttribute("data-swap")); }));

    applyMode();
  });

  function swapPoints(which) {
    if (which === "nav") {
      swap("nav-from-e", "nav-to-e");
      swap("nav-from-n", "nav-to-n");
      swap("nav-from-h", "nav-to-h");
    } else {
      swap("st-occ-e", "st-ref-e");
      swap("st-occ-n", "st-ref-n");
      swap("st-occ-h", "st-ref-h");
    }
    recompute();
  }
  function swap(a, b) {
    const t = $(a).value; $(a).value = $(b).value; $(b).value = t;
  }

  /* register the shared service worker */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("../../sw.js").catch(function () {});
  }
})();
