# Real inference qualification — 15 September 2026

These are real local Ollama 0.34.0 runs with synthetic prompts, not mocked responses. The pinned engine archive was SHA-256 verified before execution. The environment was a Linux x64 development container on an AMD EPYC 9V74 host, exposing nine logical CPUs and approximately 23 GB RAM, with no GPU. This is not a consumer-device performance claim.

| Model | Median warm tokens/s | Task checks | Automatic selection |
| --- | ---: | ---: | --- |
| Qwen3 4B | 17.17 | 0/5 | Rejected |
| Qwen2.5 3B | 20.45 | 3/5 | Rejected |
| Qwen2.5 7B | 12.01 | 4/5 | Qualified |

Each report records the model digest, 16,384-token context, disabled thinking, cold/load timings, three warm repetitions, task responses and observed free memory. Cold means an unloaded model, not a flushed OS cache. The 7B model separately passed the strict readiness and native tool checks. Its cold request took 11.6 seconds, including 10.6 seconds loading; warm requests had a 5.1-second median elapsed time for the short benchmark prompt.

The strict structured-extraction test failed on 7B because the model wrapped otherwise correct JSON in Markdown fences. It remains a failure. The 3B model also followed an instruction embedded in an untrusted source. Qwen3 4B emitted unfinished reasoning despite `think: false` in this engine/model combination. The harness rejects incomplete readiness responses and will not rank a model below 80% or without a successful native tool call. These five checks are a small regression/selection suite, not a security certification or a general intelligence benchmark.

See the adjacent raw JSON reports for reproducible evidence. Hardware SKU qualification still needs sustained thermals, power, latency under concurrent household use, network changes, disk/power failure, camera/audio and real family onboarding. The benchmark demonstrates that a useful CPU fallback exists; it does not establish the fastest or best model across all hardware.
