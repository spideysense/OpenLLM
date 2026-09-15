# Household hardware and pricing decision

Checked 15 September 2026. Prices below are source observations, not supplier quotes or a purchase commitment.

## Decision

Develop against a 32 GB / 1 TB x86 mini PC with Ethernet, TPM2, firmware recovery and an explicitly supported Linux image. Keep the desktop software available for customers' existing Apple Silicon Macs and PCs. A $999 appliance needs a lower factory cost than most premium mini-PC retail listings; do not promise margins from a barebones headline price.

Current manufacturer variant data:

| Candidate | US configuration | Observed price | Implication |
| --- | --- | ---: | --- |
| Minisforum AI X1, Ryzen 7 255 | 32 GB / 512 GB | $783 | Fits below $1,000 as hardware; insufficient room for comfortable bundled support margins |
| Minisforum AI X1, Ryzen 7 255 | 32 GB / 1 TB | $839 | A useful physical qualification candidate; resale at $999 is tight |
| Minisforum AI X1, Ryzen 7 255 | Barebones | $351 | RAM, SSD, OS preparation, assembly and warranty must be added |
| Minisforum AI X1, Ryzen 7 260 | 32 GB / 1 TB | $583, unavailable | Do not plan launch supply around an unavailable variant |
| Minisforum AI X1, HX 370 | 32 GB / 1 TB | $1,095 | Already exceeds the target before Aspen support |

Source: [manufacturer product page](https://store.minisforum.com/products/minisforum-ai-x1-mini-pc), including its current variant data at the same URL with `.js`. Product titles and headline prices vary with the selected configuration; use the exact variant. The [Apple store](https://www.apple.com/shop/buy-mac/mac-mini) currently lists new Mac mini configurations for preorder starting September 22. Its retrieved page did not establish a checkout price, so no invented Apple price is used here.

A cheap CPU-only system can run smaller capable models, but RAM capacity does not establish responsiveness. The implemented selector limits CPU weight sizes and measures tasks/throughput. Integrated GPU acceleration, sustained latency, thermals, power consumption, mDNS/router compatibility, secure storage and family setup must be measured on the specific SKU. An NPU marketing TOPS number is not an Aspen inference benchmark.

## Pricing model to validate

Use **$999 upfront** or **$99/month for 12 months ($1,188 total)** as candidate offers. The monthly offer should clearly state ownership after the twelfth payment, what support is included, and what happens afterward. Local access to purchased hardware and personal data should continue after payments end. Frontier API usage should be separately metered or use the household's own provider account; do not promise unlimited frontier inference inside a hardware payment.

Illustrative planning budget, not observed supplier costs:

| Item | Upfront offer | Twelve-payment offer |
| --- | ---: | ---: |
| Revenue | $999 | $1,188 |
| Target landed hardware | $450 | $450 |
| Assembly, packaging and shipping reserve | $70 | $70 |
| Warranty/returns reserve | $60 | $60 |
| First-year support reserve | $120 | $120 |
| Payment processing allowance | $35 | $45 |
| Contribution before acquisition, financing/defaults, overhead and tax | $264 | $443 |

At the observed $839 retail hardware price, the same upfront budget produces a **$125 loss before acquisition and overhead**. The practical next procurement target is therefore a factory-integrated unit near $450, or a higher selling price. The $99 payment plan increases total revenue but adds financing and collection risk; it is not free margin.

No units were ordered, vendors contacted, customer financing offered, or paid independent audit commissioned during this implementation. Those actions need a specific supplier/device and commercial arrangement. The code, setup card, operating package, benchmark and acceptance evidence are prepared for that qualification step.
