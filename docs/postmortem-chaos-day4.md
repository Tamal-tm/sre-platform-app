# Postmortem: Chaos Engineering Exercise — September 14, 2026

## Status
Resolved (self-induced, controlled exercise)

## Summary
Two deliberate chaos experiments were run against the Self-Healing Observable
Platform in the `sre-platform` namespace: (1) deletion of a live service-a pod
under continuous external traffic, to verify Kubernetes self-healing and
zero-downtime failover; and (2) a CPU stress test using `stress-ng` on the
single k3s node, to verify whether node-level resource contention degrades
the app enough to breach the platform's defined SLO and trigger alerting.
Both experiments produced clean, informative results. Experiment 1 confirmed
expected self-healing behavior with zero measurable user impact. Experiment 2
produced a negligible real-world effect, but in the process surfaced a real
structural gap in the platform's alerting coverage, documented below.

## Impact
- **Experiment 1 (pod kill):** Zero failed requests observed in the external
  traffic log (curl loop, 0.5s interval) throughout the entire pod
  replacement window. A brief dip was visible in Grafana's request-rate
  panel, but this was determined to be a Prometheus counter-reset/scrape-gap
  artifact from the new pod's metrics starting at zero, not a real drop in
  served traffic.
- **Experiment 2 (CPU stress):** P99 latency for the `/greet` endpoint rose
  from a baseline of ~49.5ms to ~49.7ms during the stress window — an
  increase of roughly 0.2ms, well under 1% of the platform's 300ms SLO
  threshold. No 5xx errors were recorded at any point. The
  `HighErrorBudgetBurn` alert did not fire, which was the technically correct
  outcome for the observed data — but investigation during this exercise
  found the alert would not have fired even had latency been severely
  breached, since it only evaluates 5xx error rate (see "What went poorly").

## Timeline (IST, UTC+5:30 — times as captured live during the session)
| Time | Event |
|---|---|
| ~06:1x | External curl traffic loop started against service-a NodePort (13.205.60.65:30080/greet) |
| ~06:1x | `kubectl delete pod service-a-7947cfc47c-6t48j -n sre-platform` executed |
| — | Pod observed transitioning `Terminating` → removed from Service endpoints |
| — | Replacement pod `service-a-7947cfc47c-ltjp4` created, `Pending` → `ContainerCreating` |
| +8s | Replacement pod passed readiness probe, `1/1 Running`, back in Service rotation |
| — | Curl loop confirmed zero non-200 responses across the entire window |
| 06:39:20 | `stress-ng` installed on EC2 host via apt |
| 06:44 (approx.) | Grafana P99 latency panel shows step increase begins |
| 06:46:55 | `stress-ng --cpu 2 --timeout 120s --metrics-brief` executed, pinning both node cores |
| 06:48:55 | stress-ng run completed (120.01s actual runtime) |
| ~06:49 | Grafana P99 latency panel shows step back down to baseline |
| 06:5x | Confirmed via Alertmanager UI (`localhost:9093`) that `HighErrorBudgetBurn` was not in the active alerts list |
| 06:5x | Confirmed via Prometheus (`localhost:9090`) that the alert's error-rate expression returned no data (zero 5xx requests ever recorded for `/greet`) |
| 06:5x | Confirmed via Prometheus histogram_quantile query that P99 latency moved only ~0.2ms during the stress window, nowhere near the 300ms SLO threshold |

## Root cause
**Experiment 1:** Deliberate deletion of a running pod (`kubectl delete pod`)
to test ReplicaSet self-healing and Service-level failover, with service-a
running 2 replicas and a working `httpGet` readiness probe against `/health`
on port 3000.

**Experiment 2:** Deliberate CPU exhaustion via `stress-ng --cpu 2` run
directly on the EC2 host, to simulate node-level resource contention on the
single-node k3s cluster, where all platform components (ArgoCD,
kube-prometheus-stack, Loki, and both app services) share one 2-vCPU
t3.medium instance with no second node available for the scheduler to
redistribute load to.

## What went well
- **Kubernetes self-healing worked exactly as designed.** ReplicaSet
  reconciliation replaced the deleted pod in ~8 seconds with no manual
  intervention, and the Service's endpoint-list update was fast enough that
  the external traffic log recorded zero failed requests.
- **The readiness probe did its job.** Traffic was never routed to the
  replacement pod until it was actually able to serve it, which is the
  specific mechanism that made the failover invisible to clients.
- **The app was more resilient to CPU contention than expected.** A 120-second,
  full-node CPU stress test produced only a ~0.2ms P99 latency increase on
  `/greet` — likely because the endpoint is cheap (small JSON payload, no
  external calls) and request volume was low, leaving enough scheduler
  headroom even under heavy contention.
- **The alerting pipeline behaved correctly given its actual (if incomplete)
  definition** — it did not fire a false alarm on a non-issue, which is
  itself a meaningful property of a burn-rate alert.

## What went poorly / gaps found
- **`HighErrorBudgetBurn` only monitors 5xx error rate, not latency**, even
  though the platform's SLO is explicitly defined as "99% success **and**
  <300ms latency." This means the current alerting has no coverage at all
  for pure latency degradation — if a future incident caused severe latency
  without any 5xx responses, no alert would fire regardless of how badly the
  SLO was actually being breached. This gap existed since Day 3 but was only
  surfaced by deliberately testing a failure mode (CPU contention) that
  produces latency impact without errors.
- **Default `kube-prometheus-stack` control-plane alerts are firing as
  permanent false positives on this cluster:** `KubeControllerManagerDown`,
  `KubeProxyDown`, and `KubeSchedulerDown` were all found active in
  Alertmanager. These assume a standard kubeadm-style cluster with separately
  scrapable control-plane components; k3s bundles the entire control plane
  into a single binary, so the metrics these rules look for structurally do
  not exist here. Left as-is, these permanently-firing alerts risk training
  responders to ignore the alerts list (alert fatigue), which could cause a
  real alert to be missed.
- **Grafana had no persistent storage.** Three dashboard panels built during
  Day 3 were silently lost after a routine node reboot wiped the Grafana
  pod's ephemeral filesystem, since — unlike Loki, which has a bound PVC —
  Grafana's chart values had `persistence.enabled: false` by default. This
  was found and fixed during this session (`helm upgrade` with
  `grafana.persistence.enabled=true`) but is worth flagging as a general
  pattern: verify persistence explicitly for any component whose state you
  care about keeping.

## Action items
| Action | Owner | Priority | Status |
|---|---|---|---|
| Add a dedicated latency-based SLO alert (`HighLatencySLOBreach`, P99 > 300ms for 5m) alongside the existing error-rate burn alert | Tamal | High | Drafted, not yet applied — deferred to a future session |
| Re-run the CPU stress test (likely longer/harsher) once the latency alert is in place, to confirm it fires correctly | Tamal | High | Deferred, tied to the item above |
| Disable or scope out the default k3s-incompatible control-plane alerts (KubeControllerManagerDown, KubeProxyDown, KubeSchedulerDown) to prevent alert fatigue | Tamal | Medium | Not yet done |
| Verify `KubePodCrashLooping` alert individually — determine if it reflects a real, currently-unresolved issue or is also a stale/false positive | Tamal | Medium | Not yet checked |
| Enable persistent storage for Grafana (done this session) and rebuild the 3 lost dashboard panels | Tamal | Low | Persistence fixed; panels not yet rebuilt |
| Document the single-node blast-radius tradeoff explicitly in the project README | Tamal | Medium | Not yet done |

## Lessons learned
Having monitoring and having *verified* monitoring are different claims, and
this exercise made the gap concrete rather than theoretical: the
error-rate-only burn alert looked complete on paper against a two-part SLO,
but only chaos-testing a latency-specific failure mode (rather than the
error-injection test used on Day 3) revealed that it structurally couldn't
catch half of what the SLO promises to watch. The negative results here —
"the alert didn't fire" and "the latency barely moved" — turned out to be
more informative than a dramatic failure would have been, because they
forced a genuine question ("is that because the system is resilient, or
because the alert can't see this kind of problem?") that a clean pass/fail
outcome wouldn't have raised.
