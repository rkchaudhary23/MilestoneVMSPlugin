# Milestone XProtect Mobile SDK (JavaScript)

Copy Milestone's Web SDK here before building: `XPMobileSDK.js` and its `Lib/` folder,
unchanged and with the same layout. The SDK loads its modules by relative path, so the
folder structure must stay intact. It is served at `/vms/milestone/assets/xpmobilesdk/`.

The SDK is MIT licensed. Keep its licence notice in this folder and list it in the
third-party library list for the Source Code Handover deliverable (spec §13, item 5).

The plugin calls the SDK only from `src/app/Projects/Milestone/services/milestone-sdk.service.ts`.
