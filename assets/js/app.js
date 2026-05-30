/* SmartSurveyor — landing page behaviour
 * - Renders tool cards from the registry (assets/js/tools.js)
 * - Registers the service worker (offline support)
 * - Handles the "Install app" prompt (Android/desktop) + iOS guidance
 * - Reflects online/offline status in the hero
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- tools */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  }

  function toolCard(tool) {
    var soon = tool.status === "soon";
    var statusLabel = soon ? "Coming soon" : "Open";
    var statusClass = soon ? "status--soon" : "status--ready";
    var tags = (tool.tags || [])
      .map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + "</span>";
      })
      .join("");

    var card = document.createElement(soon ? "div" : "a");
    card.className = "tool-card" + (soon ? " is-soon" : "");
    card.setAttribute("role", "listitem");
    if (!soon) {
      card.href = tool.href;
      card.setAttribute("aria-label", tool.name + " — open tool");
    }

    card.innerHTML =
      '<div class="tool-card__icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' +
      escapeHtml(tool.icon || "") +
      '"/></svg></div>' +
      '<p class="tool-card__tagline">' +
      escapeHtml(tool.tagline || "") +
      "</p>" +
      '<h3 class="tool-card__title">' +
      escapeHtml(tool.name) +
      ' <span class="status ' +
      statusClass +
      '">' +
      escapeHtml(statusLabel) +
      "</span></h3>" +
      '<p class="tool-card__desc">' +
      escapeHtml(tool.description || "") +
      "</p>" +
      '<div class="tool-card__footer">' +
      '<div class="tool-card__tags">' +
      tags +
      "</div>" +
      (soon
        ? ""
        : '<span class="tool-card__go">Open <span aria-hidden="true">&rarr;</span></span>') +
      "</div>";
    return card;
  }

  function renderTools() {
    var grid = document.getElementById("tool-grid");
    var tools = window.SMARTSURVEYOR_TOOLS || [];
    if (!grid) return;
    if (!tools.length) {
      grid.innerHTML =
        '<p class="muted">Tools are on the way — check back soon.</p>';
      return;
    }
    var frag = document.createDocumentFragment();
    tools.forEach(function (t) {
      frag.appendChild(toolCard(t));
    });
    grid.appendChild(frag);
  }

  /* ----------------------------------------------------- online/offline */
  function reflectNetwork() {
    var dot = document.getElementById("net-dot");
    var label = document.getElementById("net-label");
    if (!dot || !label) return;
    if (navigator.onLine) {
      dot.classList.remove("is-offline");
      label.textContent = "Offline-ready field toolkit";
    } else {
      dot.classList.add("is-offline");
      label.textContent = "You're offline — tools still work";
    }
  }

  /* ----------------------------------------------------- install prompt */
  var deferredPrompt = null;
  var installButtons = ["install-btn", "install-btn-hero"].map(function (id) {
    return document.getElementById(id);
  });

  function showInstallButtons(show) {
    installButtons.forEach(function (btn) {
      if (btn) btn.hidden = !show;
    });
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButtons(true);
  });

  function isIos() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    );
  }
  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  installButtons.forEach(function (btn) {
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () {
          deferredPrompt = null;
          showInstallButtons(false);
        });
      } else if (isIos()) {
        alert(
          "To install SmartSurveyor on iOS:\n\n" +
            "1. Tap the Share button (the square with an arrow).\n" +
            "2. Scroll down and choose “Add to Home Screen”.\n" +
            "3. Tap Add — it now works offline like an app."
        );
      }
    });
  });

  // iOS has no beforeinstallprompt — surface the button so users get guidance.
  if (isIos() && !isStandalone()) showInstallButtons(true);

  window.addEventListener("appinstalled", function () {
    showInstallButtons(false);
    deferredPrompt = null;
  });

  /* ------------------------------------------------- service worker / SW */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    // Register relative to this page so it works on GitHub Pages subpaths.
    navigator.serviceWorker
      .register("sw.js")
      .then(function (reg) {
        reg.addEventListener("updatefound", function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", function () {
            if (
              sw.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              showUpdateToast(reg);
            }
          });
        });
      })
      .catch(function () {
        /* registration failure is non-fatal — page still works online */
      });

    var refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  function showUpdateToast(reg) {
    var toast = document.getElementById("update-toast");
    var btn = document.getElementById("reload-btn");
    if (!toast || !btn) return;
    toast.hidden = false;
    // Use onclick (not addEventListener) so re-showing the toast never stacks
    // duplicate handlers.
    btn.onclick = function () {
      toast.hidden = true; // dismiss immediately for responsive feedback
      if (reg.waiting) {
        // Ask the waiting worker to activate; controllerchange then reloads.
        reg.waiting.postMessage("SKIP_WAITING");
        // Fallback: if controllerchange doesn't fire, reload anyway.
        setTimeout(function () {
          window.location.reload();
        }, 1500);
      } else {
        // No waiting worker to swap in — just reload the page.
        window.location.reload();
      }
    };
  }

  /* ----------------------------------------------------------- init */
  document.addEventListener("DOMContentLoaded", function () {
    renderTools();
    reflectNetwork();
    var yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  });
  window.addEventListener("online", reflectNetwork);
  window.addEventListener("offline", reflectNetwork);
  window.addEventListener("load", registerSW);
})();
