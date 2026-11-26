(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("warehouse-form");
  const button = $("send-events");
  const badge = $("warehouse-status");
  const result = $("warehouse-result");
  const error = $("warehouse-error");
  let submitted = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    result.textContent = "";

    if (submitted) {
      error.textContent = "This page has already submitted a test batch. Refresh the page before sending another batch.";
      return;
    }

    const environmentID = $("warehouse-key").value.trim();
    if (!environmentID) {
      error.textContent = "Paste the client-side Environment Key first.";
      return;
    }
    if (!window.flagsmith || typeof window.flagsmith.init !== "function") {
      error.textContent = "The Flagsmith JavaScript SDK did not load. Refresh the page and try again.";
      return;
    }

    button.disabled = true;
    button.textContent = "Initialising SDK…";
    badge.textContent = "CONNECTING";
    badge.className = "status status-off";

    try {
      await window.flagsmith.init({
        environmentID,
        enableEvents: true,
        onError: (sdkError) => {
          console.error("Flagsmith SDK error:", sdkError);
        }
      });

      const identity = "flagpilot-warehouse-check-" + crypto.randomUUID();
      await window.flagsmith.identify(identity);

      const eventNames = [
        "flagpilot_warehouse_smoke_test_1",
        "flagpilot_warehouse_smoke_test_2",
        "flagpilot_warehouse_smoke_test_3"
      ];

      for (let i = 0; i < eventNames.length; i++) {
        window.flagsmith.trackEvent(eventNames[i], {
          value: 1,
          metadata: {
            source: "flagpilot_warehouse_diagnostic",
            synthetic: true,
            sequence: i + 1
          }
        });
      }

      button.textContent = "Flushing events…";
      await window.flagsmith.flushEvents();

      submitted = true;
      badge.textContent = "SDK FLUSH COMPLETED";
      badge.className = "status status-ready";
      result.textContent =
        "The SDK accepted and flushed 3 synthetic events for identity " +
        identity +
        ". Return to Flagsmith → Environment Settings → Warehouse, refresh the page, and check Total events and Unique event names. Ingestion is asynchronous; a completed flush is not itself proof that the warehouse has ingested the events.";
      button.textContent = "Test batch sent";
    } catch (sdkError) {
      badge.textContent = "ERROR";
      badge.className = "status status-off";
      error.textContent =
        sdkError instanceof Error ? sdkError.message : String(sdkError);
      button.disabled = false;
      button.textContent = "Retry after refresh";
    }
  });
})();