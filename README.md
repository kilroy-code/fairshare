# FairShare

> Cooperative currency and safe messaging.

FairShare lets you share money and messages amongst a group of humans.

As a payment program, the group sets its own fees, which are then distributed to members.

You can join any number of groups, which each have their own currency. The members of the group vote on:
- allowing a candidate member, or ejecting an existing member
- the transaction fee for the group
- the amount of new money to mint and give to members as a basic daily income

You can pay people in your group directly, with the group's currency, and you will be charged the current average of the member's proposals for a transaction fee. The collected fee is taken out of circulation. Most groups will want to vote to make the fees offset the daily stipend.

You can pay people in other groups, too.

There is a video and a brief whitepaper at <a href="https://fairshare.social" target="fairshare">fairshare.social</a>.


## Project Packages

- **[flexstore](https://github.com/kilroy-code/flexstore)** [![npm test](https://github.com/kilroy-code/flexstore/actions/workflows/npm-test.yml/badge.svg)](https://github.com/kilroy-code/flexstore/actions/workflows/npm-test.yml) - Safe and private storage replicated between clients and relays, with realtime updates.
    - **[cache](https://github.com/kilroy-code/cache)** [![npm test](https://github.com/kilroy-code/cache/actions/workflows/npm-test.yml/badge.svg)](https://github.com/kilroy-code/cache/actions/workflows/npm-test.yml) - Simple, fast, least-recently-used in-memory cache (specifically, last set) with active time-to-live eviction, optimized for large-string keys and frequent reads.
  - **[storage](https://github.com/kilroy-code/storage)** [![npm test](https://github.com/kilroy-code/storage/actions/workflows/npm-test.yml/badge.svg)](https://github.com/kilroy-code/storage/actions/workflows/npm-test.yml) - Key-value persistent store for Web pages & PWAs.
  - **[distributed-security](https://github.com/kilroy-code/distributed-security)** [![npm test](https://github.com/kilroy-code/distributed-security/actions/workflows/npm-test.yml/badge.svg)](https://github.com/kilroy-code/distributed-security.yml) - Signed and encrypted document infrastructure based on public key encryption and self-organizing users. 
    - **[jsonrpc](https://github.com/kilroy-code/jsonprc)** - Easy setup jsonrpc using postMessage between frames or workers. Used for communication within distributed-security to isolate the keys from the app.
	- Third-party package: **[jose](https://github.com/panva/jose)**.
- **[ui-components](https://github.com/kilroy-code/ui-components)** [![npm test](https://github.com/kilroy-code/ui-components/actions/workflows/npm-test.yml/badge.svg)](https://github.com/kilroy-code/ui-components/actions/workflows/npm-test.yml) - Elegant but powerful app and UI framework based on automatic dependency-directed-backtracking, web components, and material design. 
  - **[rules](https://github.com/kilroy-code/rules)** [![npm test](https://github.com/kilroy-code/rules/actions/workflows/npm-test.yml/badge.svg)](https://github.com/kilroy-code/rules/actions/workflows/npm-test.yml) - Cached, demand-driven computations with dependency-directed-backtracking and full support for Promises. 
  - Also uses third-party packages: [@material/web](https://github.com/material-components/material-web#readme) and [qr-code-styling](https://github.com/kozakdenys/qr-code-styling)
- Also uses third party package: [qr-scanner](https://github.com/nimiq/qr-scanner#readme).



