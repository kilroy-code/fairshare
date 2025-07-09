# FairShare Release Notes

"Release" is stretching it a bit, as the app is still under rapid prototyping.

## Current Version

The bottom of "About", and the top of "tests", should say:
```
@ki1r0y/distributed-security 1.2.4
@kilroy-code/flexstore 0.0.61
@kilroy-code/ui-components 0.0.40
```

and the "About" page additionally says `Fairshare 0.6x.2`. (See next.)

If it doesn't, then please reload twice. Why twice? The app is designed to start up quickly from cached files -- even if the page server goes away or you do not have Internet connectivity. But reload also checks for new versions to put in the cache. You won't see those new versions until the _next_ reload.

## 0.7x.1
- Fix saying that it is not synchronized and missing FairShareTag, when it is synchronized: Test for populated FairShare needs to re-find.
- Fix poke reports "successful" even if no servers are configured to operate


## 0.6.2
- On error, test for crypto support, and report browser in bug report

## 0.6x.1
- pass validation options for existing, and generally harden merging

## 0.5x.2
- Dependency bundle version skew
- Data version sticks with data, not source, and give correct status on mismatch
- WAN signaling: Do not cache signaling service requests! Also clean up signaling service itself.
- LAN signaling: fix [camera and/or checkbox stays on after refresh for abandoned "Private LAN" connection](https://github.com/kilroy-code/fairshare/issues/30) and related.
- Lower base channel id for latest version of Firefox.
- [Tell user](https://github.com/kilroy-code/fairshare/issues/64) if webview, unsupported browser, or safari + !installed + notification.

## 0.4x.0
- Check for synchronization and FairShareTag before making new records, giving the user the option to go to Relays screen if necessary.
- Do not merge bogus versions.
- Fix "No viable record found" so that it gives option of bug report.

## 0.3x.1
- Improve stale source and data handling.
- x denotes a data change.
- update in-app todo
- ask os to replace activity update notifications by tag

## 0.2.8
- Fix "Cannot set properties of undefined (setting 'title')".
- Option to 'Share report' through the operating system shares, as well as through mailto: link.
- Bigger reset for stale clients.
- Fix(?) Safari intermittently failing to open one of the several data channels.
- Handle going offline/online.
- When there is activity, wake up sleeping clients that requested it, addressing [silent push](https://github.com/kilroy-code/fairshare/issues/61).
- Fix [notification preferences design is a mess](https://github.com/kilroy-code/fairshare/issues/46).

## 0.2.7
- Fix [ios safari comes back from sleep without data or displays](https://github.com/kilroy-code/fairshare/issues/55)
- Fix [chrome coming back from sleep with `Failed to execute 'createDataChannel' on 'RTCPeerConnection': The RTCPeerConnection's signalingState is 'closed'.`](https://github.com/kilroy-code/fairshare/issues/57
- data change

## 0.2.6
- Display errors [in a dialog (so visible on mobile) and offer to email the report](https://github.com/kilroy-code/fairshare/issues/58).
- Fix confusing [wrapping of header buttons](https://github.com/kilroy-code/fairshare/issues/56) if the title is too long
- Update in-app TODO list.
- Fix display of cosigners.
- Improve flow for charging against a joint account, [with toggle](https://github.com/kilroy-code/fairshare/issues/53).

## 0.2.5 - Do not sync with incompatible version
## 0.2.4 - clean db version break
## 0.2.3
- newer wrtc (on server)
- fix acceptance of group invite
- fix display of current group icon

## 0.2.2 - Fix bug in creating of new accounts

## 0.2.1 - Joint accounts

- A joint or shared account can be created by adding one or more other accounts as co-signers when creating or editing the joint account. Normally, a user cannot pull money out of another user's account by "paying" a negative amount, but a co-signer can pull money from a joint account in this way.

## 0.2.0 - Infrastructure: safer/shorter-key signing algorithm; safer persistent store with more even performance; automated testing of component packages.

- New package for local storage:
  - Uses Cache API instead of IndexedDB in browsers. (IndexDB is overkill, and has [poor performance in some browser versions or usage patterns](https://www.reddit.com/r/javascript/comments/r0axv1/why_indexeddb_is_slow_and_what_to_use_instead/), and requires some browsers to be restarted after panic-kill of storage.)
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
  - Gets rid of some dead code.
  - Addresses some subtle timing dependencies.
  - Fix service worker management.
  - Fix user creation and adding to group.
  - Each of our dependencies has headless/NodeJS regression tests that are atomatically run as GitHub Actions when checking in code, and results are displayed on the FairShare [README page](https://github.com/kilroy-code/fairshare?tab=readme-ov-file#fairshare) as a dashboard. (We do not yet automate headless in-browser testing across browsers.)
- Should address:
  - [use Ed25519 for signing instead of ECDSA](https://github.com/kilroy-code/fairshare/issues/10)
  - [DataError: Failed to execute 'get' on 'IDBObjectStore': No key or key range specified. at worker-bundle](https://github.com/kilroy-code/fairshare/issues/42)
  - [indexeddb hygiene](https://github.com/kilroy-code/fairshare/issues/9)
  - [device keys should be deleted in panic](https://github.com/kilroy-code/fairshare/issues/11)

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

