#!/usr/bin/env bash
# Model-judgment probe — the live guarantee behind Aspen's streaming "butter".
#
# Routing fast-vs-tool is now the MODEL's decision (no regex). This script
# verifies on the box that the active model keeps that judgment correct:
# conversational/emotional input must answer directly (so it streams instantly),
# and genuine action input must call a tool. Run it on the box after changing
# the model or the gateway directive.
#
#   bash scripts/probe-tool-judgment.sh [model]
#
# Expected: the conversational lines say "answered directly", the action lines
# say "CALLED A TOOL". Any conversational line that calls a tool means the
# streaming feel is at risk and the directive needs tightening.

set -euo pipefail
MODEL="${1:-qwen3.6:35b-a3b}"
HOST="http://127.0.0.1:11434/api/chat"
TOOLS='[{"type":"function","function":{"name":"web_search","description":"Search the web for current information","parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}}]'

check() { # $1 = message, $2 = expected (direct|tool)
  local body out got
  body="{\"model\":\"$MODEL\",\"stream\":false,\"think\":false,\"messages\":[{\"role\":\"user\",\"content\":\"$1\"}],\"tools\":$TOOLS}"
  out="$(curl -s "$HOST" -d "$body")"
  if echo "$out" | grep -q '"tool_calls"'; then got="tool"; else got="direct"; fi
  if [ "$got" = "$2" ]; then echo "  PASS  [$got] $1"; else echo "  FAIL  [$got, wanted $2] $1"; fi
}

echo "Model-judgment probe — $MODEL"
echo "Conversational (must answer directly):"
check "I had a rough day" direct
check "analyze our relationship" direct
check "hello" direct
check "write me a poem about autumn" direct
echo "Action (must call a tool):"
check "what is the weather in San Francisco right now" tool
check "search the web for the latest AI news" tool
