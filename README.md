# MilestoneVMSPlugin

Milestone XProtect integration for Access360. It is built to the *Access360 VMS Plugin
Developer, Deployment & Security Specification v1.0*. Section numbers below (§) refer to
that document.

The plugin is an Angular 18 app. It is served under `/vms/milestone/` and plays video with
Milestone's XProtect Mobile SDK for JavaScript, which talks from the browser to the
tenant's XProtect Mobile Server.

| Route | Opened by Access360 as | What it does |
| --- | --- | --- |
| `/vms/milestone/configuration` | New browser tab | Tenant Admin connects the Mobile Server, then fetches and syncs cameras (§6.3, UC-01) |
| `/vms/milestone/live/:cameraId` | iframe | Live video with play/pause/full screen (§6.4, UC-02, UC-05–07) |
| `/vms/milestone/archive/:cameraId?time=<ISO or epoch ms>` | iframe | Playback at a time, after checking the recorded range (§6.5, UC-03–06) |

`:cameraId` is the Milestone camera GUID that the Configuration page saved through `CamDetailsUpdate`.

## Layout

```
src/app/Projects/
├── vms.routes.ts                     entry to merge into IDCUBE's shared vms.routes.ts (§6.1)
└── Milestone/
    ├── milestone/                    root shell: router-outlet only (§6.2)
    ├── configuration/                ConfigurationComponent (§6.3)
    ├── live/                         LiveVideoComponent (§6.4)
    ├── archive/                      ArchiveVideoComponent (§6.5)
    ├── services/
    │   ├── access360-handshake.service.ts   postMessage ready/auth, DecodeData fallback (§4.3)
    │   ├── access360-api.service.ts         WebServices client, Bearer token cached 10 min (§8)
    │   ├── response-mapping.ts              reads Access360 responses (see "Open points")
    │   ├── milestone-sdk.service.ts         the only file that calls the Milestone SDK
    │   ├── frame-renderer.ts                draws the SDK's JPEG frames on a canvas
    │   └── runtime-config.service.ts        loads assets/config.json
    └── milestone.routes.ts           MILESTONE_ROUTES
docker/                               nginx template and runtime-config entrypoint
```

The component styles contain layout only, with no colours or fonts, so the plugin takes on
Access360's styling (§7).

## Before you build: add the Milestone SDK

The SDK is not in this repository. Copy Milestone's `XPMobileSDK.js` and its `Lib/` folder
into `public/assets/xpmobilesdk/`, keeping their layout (see the README in that folder).

## Develop and test

```bash
npm ci
npm start            # http://localhost:4200/configuration (no base href in dev)
npm test             # unit tests in headless Chrome; set CHROME_BIN if Chrome is not on PATH
npm run build:prod   # production build with --base-href /vms/milestone/
```

The pages need Access360 to open them, because they wait for the postMessage handshake.
Develop against IDCUBE's test environment (§10.1). If you open a page directly, it shows
"Open this page from Access360".

## Container

```bash
docker build -t vms-milestone:1.0.0 .
docker run -p 4505:4505 -e A360_TOKEN_ENDPOINT=GetToken vms-milestone:1.0.0
# http://localhost:4505/vms/milestone/   health check: /healthz
```

- The build stage uses Node 18. The runtime is `nginx-unprivileged` (non-root, §11.2) and
  listens on `$PORT`, which defaults to 4505. Set it to the port IDCUBE assigns in the
  shared Pod (§10.3–10.4).
- At start-up, these environment variables are written to `assets/config.json`:

  | Variable | Default | Meaning |
  | --- | --- | --- |
  | `A360_BACKEND_BASE_URL` | empty (same origin) | Access360 backend root; calls go to `<root>/WebServices/...` |
  | `A360_TOKEN_ENDPOINT` | `GetToken` | `GetToken` for cloud, `GetTokenjwt` for on-premises (§8.1–8.2) |
  | `A360_ORIGIN` | empty | Origin allowed to answer the handshake. Empty means the referrer's origin, else the page's own origin |
  | `A360_DECODE_DATA_PARAM` | `data` | Query parameter that carries the legacy DecodeData token |

  With a read-only root filesystem, leave these unset and mount `config.json` from a ConfigMap.
- The container's nginx sets `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`,
  `nosniff` and `Referrer-Policy`. TLS, HSTS and the full CSP belong at the Ingress and
  shared router (§10.5).

## Open points to confirm with IDCUBE

The spec does not give these details, so the code makes the assumptions below. Each one
lives in a single place so that it is easy to change.

1. **API contracts.** The request and response bodies for `SaveConfiguration`,
   `AddModVMSDetails` (its response), `GetCamDetailsByBranchId`, `CamDetailsUpdate` and
   `DecodeData` are guesses based on §8. Request bodies are built in
   `access360-api.service.ts`. Responses are read in `response-mapping.ts`, which accepts
   several field-name spellings and a `data` wrapper.
2. **GetToken / GetTokenjwt.** The request sends no body and relies on the signed-in
   Access360 session cookie (`withCredentials`), because the spec says Access360 handles
   the integration's credentials.
3. **Archive time.** The archive page reads the event time from `?time=`. The spec does
   not say how Access360 passes it.
4. **Milestone SDK calls.** I wrote the adapter in `milestone-sdk.service.ts` from the
   SDK's documented pattern without the SDK files to hand: `connect`/`login` observers,
   `RequestStream` with `SignalType`/`SeekType`/`Time`, `playbackSpeed`, `playbackGoTo`,
   `getAllCameras`, `getDBStartTime` and `getSequencesInInterval`. Check it against the SDK
   version Milestone supplies, especially how the login type is passed.
5. **Network path to the Mobile Server.** The browser connects directly over HTTPS/WSS.
   The Mobile Server must therefore have a trusted certificate, be reachable from users'
   browsers, and allow cross-origin calls from Access360. An alternative is to proxy it
   (there is a commented example in `docker/nginx.conf.template`), but a static proxy only
   works with one Mobile Server per deployment.
6. **Milestone password in the browser.** The SDK logs in from JavaScript, so
   `GetVmsConfigurationByEmail` has to return the Milestone password to the browser. Use a
   dedicated Milestone user with view-only rights.
7. **Base href and routes.** The image is built with `--base-href /vms/milestone/`, so
   `app.routes.ts` mounts the routes at the root. `Projects/vms.routes.ts` holds the entry
   for IDCUBE's shared workspace.

## Tests in this repository

- Unit tests (19) cover the handshake (origin and source checks, payload validation,
  timeout), the 10-minute token cache, response mapping, the camera diff, URL validation
  and archive time parsing.
- The full flow has been exercised only against mocks: a stub SDK and mocked WebServices.
  It has not yet been tested against a real Milestone server or a real Access360 instance.
