# Skill: Analytics & Metrics

## Setting Up Analytics
For any web app, implement these tracking layers:

### Page Views & Events
```html
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXX');

  // Custom events
  function trackEvent(name, params) {
    gtag('event', name, params);
  }
</script>
```

### Key Events to Track
- `page_view` — automatic
- `sign_up` — user creates account
- `first_action` — user completes core action
- `upgrade` — user starts paying
- `feature_used` — each major feature usage
- `error` — JS errors, API failures

## Metric Frameworks

### North Star Metric
One metric that best captures value delivered to users:
- **Slack**: daily messages sent
- **Airbnb**: nights booked
- **Aspen**: daily conversations completed

### AARRR Pirate Metrics
| Stage | Metric | Example |
|---|---|---|
| Acquisition | Visitors | Unique site visits |
| Activation | First value | Completed first chat |
| Retention | Return rate | Weekly active users |
| Revenue | Paying users | Subscription starts |
| Referral | Viral factor | Users who share |

### Cohort Analysis
Track groups of users by signup week:
- Week 0: 100% (signed up)
- Week 1: 40% returned
- Week 4: 15% still active
- Week 12: 8% retained
Good retention: >20% at week 4 for consumer, >40% for B2B

## Dashboard Design
Build dashboards with this hierarchy:
1. **Executive view**: 4-6 KPI cards, trend lines
2. **Funnel view**: conversion rates between stages
3. **Engagement view**: DAU/WAU/MAU, session duration, feature usage
4. **Revenue view**: MRR, churn, LTV, CAC

## SQL Patterns for Analytics
```sql
-- Daily active users
SELECT DATE(created_at) as day, COUNT(DISTINCT user_id) as dau
FROM events GROUP BY 1 ORDER BY 1;

-- Retention cohort
SELECT DATE_TRUNC('week', u.created_at) as cohort,
  DATE_TRUNC('week', e.created_at) as active_week,
  COUNT(DISTINCT e.user_id) as users
FROM users u JOIN events e ON u.id = e.user_id
GROUP BY 1, 2;

-- Conversion funnel
SELECT
  COUNT(DISTINCT CASE WHEN event = 'visit' THEN user_id END) as visitors,
  COUNT(DISTINCT CASE WHEN event = 'signup' THEN user_id END) as signups,
  COUNT(DISTINCT CASE WHEN event = 'activate' THEN user_id END) as activated
FROM events WHERE created_at > NOW() - INTERVAL '30 days';
```

## A/B Testing
- Minimum sample: 1,000 per variant for statistical significance
- Run for at least 2 full weeks (capture weekly cycles)
- Test one variable at a time
- Primary metric + guardrail metric
- Use 95% confidence level (p < 0.05)
