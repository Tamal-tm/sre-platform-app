# Service Level Objective — service-a `/greet`

## SLI (Service Level Indicator)
Proportion of requests to `/greet` that return HTTP 2xx status within 300ms.

## SLO (Service Level Objective)
99% of requests meet the SLI, measured over a rolling 7-day window.

## Error Budget
Window = 7 days = 168 hours = 10,080 minutes
SLO = 99% -> allowed failure rate = 1% = 0.01
Error budget = 0.01 x 10,080 minutes = 100.8 minutes/week

## Measurement queries (PromQL)

Success ratio:
sum(rate(http_requests_total{route="/greet",status=~"2.."}[5m]))
/
sum(rate(http_requests_total{route="/greet"}[5m]))

Latency ratio (requests under 300ms):
sum(rate(http_request_duration_seconds_bucket{route="/greet",le="0.3"}[5m]))
/
sum(rate(http_request_duration_seconds_count{route="/greet"}[5m]))

p95 latency:
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{route="/greet"}[5m])) by (le))
