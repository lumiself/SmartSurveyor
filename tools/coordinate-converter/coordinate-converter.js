/* SmartSurveyor — Coordinate Converter
 * --------------------------------------------------------------------------
 * Nahrwan 1967 / UTM zone 39N (EPSG:27039) ⇄ WGS84, plus DMS → decimal.
 *
 * Pipeline (UTM → WGS84):
 *   UTM (Clarke 1880) → geographic (Clarke 1880) → geocentric XYZ (Clarke 1880)
 *   → +Helmert shift → geocentric XYZ (WGS84) → geographic (WGS84)
 * and the exact reverse for WGS84 → UTM.
 *
 * The datum shift is the 3-parameter geocentric translation for the UAE:
 *   X_wgs = X_nahrwan + ΔX,  with (ΔX, ΔY, ΔZ) = (−249, −156, +381) m.
 * Pure JS, no dependencies, fully offline.
 */
(function () {
  "use strict";

  // ---- ellipsoids -----------------------------------------------------------
  function ellipsoid(a, invF) {
    const f = 1 / invF;
    const e2 = f * (2 - f);
    return { a: a, f: f, e2: e2, ep2: e2 / (1 - e2) };
  }
  const WGS84 = ellipsoid(6378137.0, 298.257223563);
  const CLARKE = ellipsoid(6378249.145, 293.465); // Clarke 1880 (RGS)

  // ---- UTM zone 39N ----------------------------------------------------------
  const K0 = 0.9996;
  const FE = 500000; // false easting
  const FN = 0; // false northing (northern hemisphere)

  // Central meridian of a UTM zone, in radians (zone 39 → 51°E, zone 40 → 57°E).
  function cmRad(zone) { return (zone * 6 - 183) * D2R; }
  // Standard UTM zone for a WGS84 longitude (UAE falls in 39 or 40).
  function autoZone(lonDeg) { return Math.floor((lonDeg + 180) / 6) + 1; }

  // 3-parameter datum shift, Nahrwan 1967 → WGS84 (UAE)
  const DX = -249, DY = -156, DZ = 381;

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // ---- geographic → geocentric (ECEF) ---------------------------------------
  function geoToEcef(latDeg, lonDeg, h, el) {
    const lat = latDeg * D2R, lon = lonDeg * D2R;
    const sin = Math.sin(lat), cos = Math.cos(lat);
    const N = el.a / Math.sqrt(1 - el.e2 * sin * sin);
    return {
      x: (N + h) * cos * Math.cos(lon),
      y: (N + h) * cos * Math.sin(lon),
      z: (N * (1 - el.e2) + h) * sin,
    };
  }

  // ---- geocentric (ECEF) → geographic (iterative) ---------------------------
  function ecefToGeo(p, el) {
    const lon = Math.atan2(p.y, p.x);
    const r = Math.hypot(p.x, p.y);
    let lat = Math.atan2(p.z, r * (1 - el.e2));
    let h = 0;
    for (let i = 0; i < 8; i++) {
      const sin = Math.sin(lat);
      const N = el.a / Math.sqrt(1 - el.e2 * sin * sin);
      h = r / Math.cos(lat) - N;
      lat = Math.atan2(p.z, r * (1 - el.e2 * N / (N + h)));
    }
    return { lat: lat * R2D, lon: lon * R2D, h: h };
  }

  // ---- meridional arc helpers (Snyder, 1987) --------------------------------
  function meridianArc(lat, el) {
    const e2 = el.e2, e4 = e2 * e2, e6 = e4 * e2;
    return el.a * (
      (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat)
      - (35 * e6 / 3072) * Math.sin(6 * lat)
    );
  }

  // ---- geographic → UTM (Snyder transverse Mercator, forward) ---------------
  function geoToUtm(latDeg, lonDeg, el, zone) {
    const LON0 = cmRad(zone);
    const lat = latDeg * D2R, lon = lonDeg * D2R;
    const e2 = el.e2, ep2 = el.ep2;
    const sin = Math.sin(lat), cos = Math.cos(lat), tan = Math.tan(lat);
    const N = el.a / Math.sqrt(1 - e2 * sin * sin);
    const T = tan * tan;
    const C = ep2 * cos * cos;
    const A = (lon - LON0) * cos;
    const M = meridianArc(lat, el);

    const A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;
    const E = FE + K0 * N * (
      A + (1 - T + C) * A3 / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120
    );
    const Nn = FN + K0 * (
      M + N * tan * (
        A2 / 2 + (5 - T + 9 * C + 4 * C * C) * A4 / 24
        + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720
      )
    );
    return { E: E, N: Nn };
  }

  // ---- UTM → geographic (Snyder transverse Mercator, inverse) ---------------
  function utmToGeo(E, Nn, el, zone) {
    const LON0 = cmRad(zone);
    const e2 = el.e2, ep2 = el.ep2;
    const M = (Nn - FN) / K0;
    const mu = M / (el.a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const e1_2 = e1 * e1, e1_3 = e1_2 * e1, e1_4 = e1_3 * e1;
    const phi1 = mu
      + (3 * e1 / 2 - 27 * e1_3 / 32) * Math.sin(2 * mu)
      + (21 * e1_2 / 16 - 55 * e1_4 / 32) * Math.sin(4 * mu)
      + (151 * e1_3 / 96) * Math.sin(6 * mu)
      + (1097 * e1_4 / 512) * Math.sin(8 * mu);

    const sin = Math.sin(phi1), cos = Math.cos(phi1), tan = Math.tan(phi1);
    const C1 = ep2 * cos * cos;
    const T1 = tan * tan;
    const N1 = el.a / Math.sqrt(1 - e2 * sin * sin);
    const R1 = el.a * (1 - e2) / Math.pow(1 - e2 * sin * sin, 1.5);
    const D = (E - FE) / (N1 * K0);
    const D2 = D * D, D3 = D2 * D, D4 = D3 * D, D5 = D4 * D, D6 = D5 * D;

    const lat = phi1 - (N1 * tan / R1) * (
      D2 / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D6 / 720
    );
    const lon = LON0 + (
      D - (1 + 2 * T1 + C1) * D3 / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5 / 120
    ) / cos;

    return { lat: lat * R2D, lon: lon * R2D };
  }

  // ---- full pipelines --------------------------------------------------------
  function nahrwanUtmToWgs84(E, Nn, zone) {
    const nah = utmToGeo(E, Nn, CLARKE, zone);
    const ecef = geoToEcef(nah.lat, nah.lon, 0, CLARKE);
    ecef.x += DX; ecef.y += DY; ecef.z += DZ; // Nahrwan → WGS84
    const wgs = ecefToGeo(ecef, WGS84);
    return { wgs: wgs, nah: nah };
  }

  function wgs84ToNahrwanUtm(latDeg, lonDeg, zone) {
    const ecef = geoToEcef(latDeg, lonDeg, 0, WGS84);
    ecef.x -= DX; ecef.y -= DY; ecef.z -= DZ; // WGS84 → Nahrwan
    const nah = ecefToGeo(ecef, CLARKE);
    const utm = geoToUtm(nah.lat, nah.lon, CLARKE, zone);
    return { utm: utm, nah: nah, wgs: { lat: latDeg, lon: lonDeg } };
  }

  // ---- formatting ------------------------------------------------------------
  function toDms(value, isLat) {
    const hemi = value < 0 ? (isLat ? "S" : "W") : (isLat ? "N" : "E");
    let v = Math.abs(value);
    let d = Math.floor(v);
    let mFull = (v - d) * 60;
    let m = Math.floor(mFull);
    let s = (mFull - m) * 60;
    // guard against rounding pushing seconds to 60
    if (s >= 59.9995) { s = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    return d + "°" + String(m).padStart(2, "0") + "'" +
      s.toFixed(3).padStart(6, "0") + '"' + hemi;
  }

  function fmt(n, dp) { return Number(n).toFixed(dp); }

  // ---- DMS parsing -----------------------------------------------------------
  // Accepts "25 14 30.5 N", "-25 14 30.5", "55 16", "25.2418", with spaces,
  // °, ', " or commas as separators and an optional N/S/E/W hemisphere letter.
  function parseDms(raw) {
    if (raw == null) return NaN;
    let s = raw.trim();
    if (!s) return NaN;
    s = s.toUpperCase();

    let sign = 1;
    // hemisphere letter (leading or trailing)
    const hemiMatch = s.match(/[NSEW]/);
    if (hemiMatch) {
      const h = hemiMatch[0];
      if (h === "S" || h === "W") sign = -1;
      s = s.replace(/[NSEW]/g, " ");
    }
    if (s.indexOf("-") !== -1) { sign = -1; }

    // pull out the numeric tokens (degrees, minutes, seconds)
    const nums = s.match(/\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return NaN;

    const deg = parseFloat(nums[0]) || 0;
    const min = nums.length > 1 ? parseFloat(nums[1]) : 0;
    const sec = nums.length > 2 ? parseFloat(nums[2]) : 0;

    if (min >= 60 || sec >= 60) return NaN;
    return sign * (deg + min / 60 + sec / 3600);
  }

  // ---- DOM helpers -----------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-shown"), 1800);
  }

  function showBanner(id, msg) {
    const b = $(id);
    if (msg) { b.textContent = msg; b.classList.add("is-shown"); }
    else { b.textContent = ""; b.classList.remove("is-shown"); }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast("Copied"),
        () => toast("Copy failed")
      );
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("Copied"); }
      catch (e) { toast("Copy failed"); }
      document.body.removeChild(ta);
    }
  }

  function mapsUrl(lat, lon) {
    return "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(lat.toFixed(8) + "," + lon.toFixed(8));
  }

  function shareLocation(lat, lon, label) {
    const url = mapsUrl(lat, lon);
    const text = label + ": " + lat.toFixed(6) + ", " + lon.toFixed(6);
    if (navigator.share) {
      navigator.share({ title: "SmartSurveyor location", text: text, url: url })
        .catch(() => {});
    } else {
      copyText(text + " " + url);
      toast("Link copied");
    }
  }

  // ---------------------------------------------------------------------------
  // Datum & grid converter wiring
  // ---------------------------------------------------------------------------
  let lastWgs = null; // remember the last WGS84 result for Maps/share/copy

  function currentDir() {
    const checked = document.querySelector('input[name="dir"]:checked');
    return checked ? checked.value : "utm2wgs";
  }

  function syncDirInputs() {
    const dir = currentDir();
    $("utm-inputs").hidden = dir !== "utm2wgs";
    $("wgs-inputs").hidden = dir !== "wgs2utm";
    updateZoneUI();
  }

  // Keep the zone control in step with the direction and the Auto toggle.
  function updateZoneUI() {
    const dir = currentDir();
    const auto = $("zone-auto");
    const num = $("zone-num");
    if (dir === "utm2wgs") {
      // No longitude to detect from — the zone must be supplied.
      auto.checked = false;
      auto.disabled = true;
      num.disabled = false;
      $("zone-sub").textContent = "Zone is required to convert from UTM (39N or 40N for the UAE).";
    } else {
      auto.disabled = false;
      num.disabled = auto.checked;
      $("zone-sub").textContent = auto.checked
        ? "Auto-detects the zone (39N or 40N) from the longitude."
        : "Manual zone. The UAE uses 39N (west) or 40N (east of 54°E).";
    }
  }

  function runConvert() {
    showBanner("conv-banner", "");
    $("conv-banner").className = "banner banner--err"; // reset to error styling
    const dir = currentDir();
    let res, utmE, utmN, zone;

    if (dir === "utm2wgs") {
      utmE = parseFloat($("easting").value);
      utmN = parseFloat($("northing").value);
      if (!isFinite(utmE) || !isFinite(utmN)) {
        return showBanner("conv-banner", "Enter both Easting and Northing.");
      }
      zone = parseInt($("zone-num").value, 10);
      if (!(zone >= 1 && zone <= 60)) {
        return showBanner("conv-banner", "Enter a UTM zone between 1 and 60.");
      }
      res = nahrwanUtmToWgs84(utmE, utmN, zone);
    } else {
      const lat = parseFloat($("wlat").value);
      const lon = parseFloat($("wlon").value);
      if (!isFinite(lat) || !isFinite(lon)) {
        return showBanner("conv-banner", "Enter both Latitude and Longitude.");
      }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return showBanner("conv-banner", "Latitude must be ±90° and longitude ±180°.");
      }
      if ($("zone-auto").checked) {
        zone = autoZone(lon);
        $("zone-num").value = zone; // reflect the auto-picked zone back to the user
      } else {
        zone = parseInt($("zone-num").value, 10);
        if (!(zone >= 1 && zone <= 60)) {
          return showBanner("conv-banner", "Enter a UTM zone between 1 and 60.");
        }
      }
      res = wgs84ToNahrwanUtm(lat, lon, zone);
      utmE = res.utm.E;
      utmN = res.utm.N;
    }

    lastWgs = res.wgs;

    // Zones 37–40 over the UAE map to EPSG:27037–27040.
    const epsg = (zone >= 37 && zone <= 40) ? " · EPSG:270" + zone : "";

    $("r-wgs-dec").textContent = fmt(res.wgs.lat, 8) + ", " + fmt(res.wgs.lon, 8);
    $("r-wgs-dms").textContent = toDms(res.wgs.lat, true) + "  " + toDms(res.wgs.lon, false);
    $("r-nah-dec").textContent = fmt(res.nah.lat, 8) + ", " + fmt(res.nah.lon, 8);
    $("r-utm").textContent = "E " + fmt(utmE, 3) + "  N " + fmt(utmN, 3) + "  (zone " + zone + "N" + epsg + ")";

    // Maps button reflects WGS84 result
    $("maps-btn").href = mapsUrl(res.wgs.lat, res.wgs.lon);

    $("conv-result").classList.add("is-shown");

    // Friendly nudge if the point falls outside the published area of use.
    if (res.wgs.lon < 51.5 || res.wgs.lon > 57.13 || res.wgs.lat < 22.63 || res.wgs.lat > 26.27) {
      showBanner("conv-banner",
        "Note: this point is outside the published area of use (UAE / EPSG:27039). The result may be less accurate.");
      $("conv-banner").className = "banner banner--warn is-shown";
    }
  }

  function clearConvert() {
    ["easting", "northing", "wlat", "wlon"].forEach((id) => { $(id).value = ""; });
    $("zone-num").value = "39";
    if (!$("zone-auto").disabled) $("zone-auto").checked = true;
    updateZoneUI();
    $("conv-result").classList.remove("is-shown");
    showBanner("conv-banner", "");
    lastWgs = null;
  }

  // ---------------------------------------------------------------------------
  // DMS → decimal wiring (single reading, e.g. "90 00 00" → 90.000°)
  // ---------------------------------------------------------------------------
  let lastDms = null;

  function runDms() {
    showBanner("dms-banner", "");
    const raw = $("dms-in").value;
    if (!raw.trim()) {
      return showBanner("dms-banner", "Enter a DMS reading, e.g. 90 00 00");
    }
    const dec = parseDms(raw);
    if (!isFinite(dec)) {
      return showBanner("dms-banner", "Couldn't read that. Try e.g. 90 00 00");
    }

    lastDms = dec;
    $("r-dms").textContent = fmt(dec, 6) + "°";
    $("dms-result").classList.add("is-shown");
  }

  function clearDms() {
    $("dms-in").value = "";
    $("dms-result").classList.remove("is-shown");
    showBanner("dms-banner", "");
    lastDms = null;
  }

  // ---------------------------------------------------------------------------
  // Use current GPS location → convert to Nahrwan
  // ---------------------------------------------------------------------------
  function useCurrentLocation() {
    const btn = $("loc-btn");
    const label = $("loc-btn-label");
    if (!("geolocation" in navigator)) {
      return showBanner("conv-banner", "This device can't share its location.");
    }
    showBanner("conv-banner", "");
    $("conv-banner").className = "banner banner--err";
    const original = label.textContent;
    label.textContent = "Locating…";
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        label.textContent = original;
        btn.disabled = false;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        // Switch to WGS84 → Nahrwan, fill the fields, auto-detect the zone.
        const wgs2utm = document.querySelector('input[name="dir"][value="wgs2utm"]');
        wgs2utm.checked = true;
        syncDirInputs();
        $("wlat").value = lat.toFixed(8);
        $("wlon").value = lon.toFixed(8);
        $("zone-auto").checked = true;
        updateZoneUI();
        runConvert();
        toast("Located ±" + Math.round(pos.coords.accuracy) + " m");
      },
      (err) => {
        label.textContent = original;
        btn.disabled = false;
        const msg = err.code === err.PERMISSION_DENIED
          ? "Location permission denied. Enable it to use your GPS position."
          : "Couldn't get a location fix. Try again outdoors.";
        showBanner("conv-banner", msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------
  document.querySelectorAll('input[name="dir"]').forEach((r) =>
    r.addEventListener("change", () => { syncDirInputs(); showBanner("conv-banner", ""); })
  );

  $("zone-auto").addEventListener("change", updateZoneUI);

  $("convert-btn").addEventListener("click", runConvert);
  $("loc-btn").addEventListener("click", useCurrentLocation);
  $("clear-btn").addEventListener("click", clearConvert);
  $("maps-btn").addEventListener("click", (e) => {
    if (!lastWgs) e.preventDefault();
  });
  $("share-btn").addEventListener("click", () => {
    if (lastWgs) shareLocation(lastWgs.lat, lastWgs.lon, "WGS84");
  });
  $("copy-btn").addEventListener("click", () => {
    if (lastWgs) copyText(lastWgs.lat.toFixed(8) + ", " + lastWgs.lon.toFixed(8));
  });

  $("dms-btn").addEventListener("click", runDms);
  $("dms-clear").addEventListener("click", clearDms);
  $("dms-copy").addEventListener("click", () => {
    if (lastDms != null) copyText(fmt(lastDms, 6));
  });

  // Enter key submits the relevant panel
  ["easting", "northing", "wlat", "wlon", "zone-num"].forEach((id) =>
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") runConvert(); })
  );
  $("dms-in").addEventListener("keydown", (e) => { if (e.key === "Enter") runDms(); });

  syncDirInputs();
})();
