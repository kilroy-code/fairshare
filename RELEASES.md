# FairShare Release Notes

"Release" is stretching it a bit, as the app is still under rapid prototyping.

## Current Version

The bottom of "About" and the top of "tests" should say:
```
@ki1r0y/distributed-security 1.1.3
@kilroy-code/flexstore 0.0.30
@kilroy-code/ui-components 0.0.27
```

and the "About" page additionally says `Fairshare 0.1.8`.

If it doesn't, then please reload twice. Why twice? The app is designed to start up quickly from cached files -- even if the page server goes away or you do not have Internet connectivity. But reload also checks for new versions to put in the cache. You won't see those new versions until the _next_ reload.

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

