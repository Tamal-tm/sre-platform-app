const express = require("express");
const axios = require("axios");
const app = express();
const PORT = 3000;

// In-cluster DNS name: <service-name>.<namespace>.svc.cluster.local
// k3s runs CoreDNS by default, so this resolves automatically once
// service-b's k8s Service exists - no hardcoded IPs anywhere.
const SERVICE_B_URL = process.env.SERVICE_B_URL || "http://service-b:5000";

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.get("/greet", async (req, res) => {
  try {
    const { data } = await axios.get(`${SERVICE_B_URL}/quote`, {
      timeout: 2000,
    });
    res.json({
      message: "Hello from service-a",
      quote_of_the_moment: data.quote,
    });
  } catch (err) {
    // Deliberately don't crash the whole response if the downstream
    // service is unreachable - this partial-failure path becomes an
    // SLO/error-budget conversation on Day 3.
    res.status(502).json({
      message: "Hello from service-a",
      error: "quote service unavailable",
    });
  }
});

app.listen(PORT, () => console.log(`service-a listening on ${PORT}`));
