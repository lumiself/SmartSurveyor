/* SmartSurveyor — tool registry
 * --------------------------------------------------------------------------
 * THIS IS THE ONLY FILE YOU EDIT TO ADD A NEW TOOL.
 *
 * Each tool lives in its own folder under /tools/<slug>/ and gets one entry
 * below. The landing page renders these cards automatically. To add a tool:
 *
 *   1. Create  tools/<slug>/index.html
 *   2. Add an object here with a matching `href`
 *   3. Set `status` to "ready" when it works, "soon" while it's a placeholder
 *
 * `icon` is inline SVG path data (24x24 viewBox) so cards stay offline and
 * dependency-free.
 */
window.SMARTSURVEYOR_TOOLS = [
  {
    slug: "gnss-planner",
    name: "GNSS Planner",
    tagline: "Live satellites · sky plot · DOP",
    description:
      "Real orbital data propagated to right now: satellites in view, a polar sky plot and PDOP/HDOP/VDOP — plus your device's live fix accuracy. Check a benchmark before you set up the base.",
    href: "tools/gnss-planner/",
    status: "ready",
    tags: ["gnss", "planning", "live"],
    icon:
      "M9 8h6v4H9z M2 9h5v6H2z M17 9h5v6h-5z M11.5 2h1v6h-1z M12 0.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z",
  },
  {
    slug: "coordinate-converter",
    name: "Coordinate Converter",
    tagline: "Lat/Long ⇄ UTM ⇄ DMS",
    description:
      "Convert between decimal degrees, degrees-minutes-seconds and UTM grid coordinates. Built for quick field checks without a signal.",
    href: "tools/coordinate-converter/",
    status: "soon",
    tags: ["geodesy", "conversion"],
    icon:
      "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z",
  },
  {
    slug: "bearing-distance",
    name: "Bearing & Distance",
    tagline: "Inverse & forward computations",
    description:
      "Compute bearing and distance between two points, or project a new point from a known station. Whole-circle and quadrant bearings.",
    href: "tools/bearing-distance/",
    status: "soon",
    tags: ["traverse", "cogo"],
    icon:
      "M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2zm0 4.53 4.26 10.4L12 15.4l-4.26 1.53L12 6.53z",
  },
];
