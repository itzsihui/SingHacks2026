# 90-second live demo script

Open `/demo`. Click **Run full 90s script** (or narrate the clicks below).

## Clock

| Time | Say | Show |
|---|---|---|
| 0:00–0:15 | “Borneo is the merchant protocol for AI agents — Shopify for agents, not another chatbot.” | Landing / demo split-screen |
| 0:15–0:30 | “Merchant publishes inventory in **XSGD**. Agents read `llms.txt`, never HTML.” | Merchant pane publish |
| 0:30–1:00 | “**Avalanche x402**: unpaid POST → **HTTP 402** → agent pays XSGD on C-Chain → **200** + Snowtrace.” | Red 402 → green 200 in protocol log; open Snowtrace |
| 1:00–1:20 | “**StraitsX** rail: scoped virtual card — spend cap, merchant whitelist, expiry — then burn.” | Card rail lines + dashboard StraitsX row |
| 1:20–1:30 | “**AWS**: Bedrock runs the agents when available; protocol is API Gateway + Lambda + DynamoDB with CloudWatch on 402→200.” | Dashboard AWS line / CloudWatch screenshot |

## Fail-soft

- No buyer key → still show **402** (Avalanche visual).
- No Bedrock creds → deterministic tools; handshake unchanged.
- No AWS deploy yet → local Next protocol still demos; deploy when credits land.
