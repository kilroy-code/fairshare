# FairShare Release Notes

"Release" is stretching it a bit, as the app is still under rapid prototyping.

## Current Version

The bottom of "About" and the top of "tests" should say:
```
@ki1r0y/distributed-security 1.2.3
@kilroy-code/flexstore 0.0.36
@kilroy-code/ui-components 0.0.28
```

and the "About" page additionally says `Fairshare 0.2.0`. (See next.)

If it doesn't, then please reload twice. Why twice? The app is designed to start up quickly from cached files -- even if the page server goes away or you do not have Internet connectivity. But reload also checks for new versions to put in the cache. You won't see those new versions until the _next_ reload.

## 0.2.0 - Infrastructure: safer/shorter-key signing algorithm; safer persistent store with more even performance; automated testing of component packages.

- New package for local storage:
  - Uses Cache API instead of IndexedDB in browsers. [IndexDB is overkill, and has (poor performance in some browser versions or usage patterns](https://www.reddit.com/r/javascript/comments/r0axv1/why_indexeddb_is_slow_and_what_to_use_instead/), and requires some browsers to be restarted after panic-kill of storage.)
  - Uses file system in NodeJS with good performance _except_ for `put` on OSX. (OSX file system flush is _terrible_!)
  - Has it's own test suite.
- New distributed-security version:
  - Uses new storage package for device keys.
  - Uses [Ed25519 for signing instead of ECDSA](https://github.com/kilroy-code/fairshare/issues/10):
    - ECDSA is considered to potentially be broken by government agencies, and is no longer recommended.
    - The last browser to include support for Ed25519, Chrome, has now done so on all platforms. **You must update to the latest Chrome version.**
    - Ed25519 uses much smaller tags - 43 characters each instead of 132 - which appear in FairShare URL `user` and `group` query parameters. Thus the URLs are smaller, more readable, and work reliably in QR codes.
- FairShare
  - Uses new keys and storage.
  - Addresses some subtle timing dependencies.
  - Each of our dependencies has headless/NodeJS regression tests that are atomatically run as GitHub Actions when checking in code, and results are displayed on the FairShare [README page](https://github.com/kilroy-code/fairshare?tab=readme-ov-file#fairshare) as a dashboard. (We do not yet automate headless in-browser testing across browsers.)
- Should address:
  - [use Ed25519 for signing instead of ECDSA](https://github.com/kilroy-code/fairshare/issues/10)
  - [DataError: Failed to execute 'get' on 'IDBObjectStore': No key or key range specified. at worker-bundle](https://github.com/kilroy-code/fairshare/issues/42)
  - [indexeddb hygiene](https://github.com/kilroy-code/fairshare/issues/9)

## 0.1.8

- Fix subtle timing variance that might have been tickling some versions of Safari.

## 0.1.7

- Fix subtle timing variance that could cause connection problems such as a recurrence of https://github.com/kilroy-code/fairshare/issues/15 and maybe https://github.com/kilroy-code/fairshare/issues/34

## 0.1.6

- Messages (text and payments).
- Notifications (without going through a "Push" server).
- Offline operations and source caching with updates.

## Prior versions

- Users
  - Public directory (e.g., populating dropdowns)
  - Invite someone to join, by QR code or OS-shared link
  - Create new profile (if first invited, or an additional profile of an existing user)
  - Edit profile (name, picture (defaults to identicon), recovery questions
  - Switch between profiles
  - Add profile to another device / recover after wiping
- Groups
  - Create new group
  - Edit group (name, picture (defaults to identicon))
  - Switch between groups
  - Daily stipend / tax rate
- Money
  - Balance (reflective of stipend)
  - Pay within group (and payment shown among messages)
  - Ask an existing user to pay you (showing QR code and OS-shareable link)
- Connect to others
  - Connect to peer, synchronize data, and update in real time
    - Through a rendezvous server
    - Run a public rendezvous server
    - Face 2 Face through a hotspot, using QR codes
  - Connect to a relay (and to anyone else on that same relay), sync and update
    - Run a public relay server
  - Show connectivity and synchronization state
  - “Panic button” to recoverable wipe all local data, keys.
- PWA
  - “About” information

