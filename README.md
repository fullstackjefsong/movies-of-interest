# Movies of Interest

A local-first movie and TV watchlist by **SONG Labs**. A private SQLite library,
a browser interface, and a Windows installer with a bundled Node runtime.

## Install (Windows 10/11, x64)

**[Download the installer](https://github.com/fullstackjefsong/movies-of-interest/releases/latest/download/MoviesOfInterest-Setup-1.0.1.exe)**
(`MoviesOfInterest-Setup-1.0.1.exe`, from the
[latest release](https://github.com/fullstackjefsong/movies-of-interest/releases/latest)).
**Do not download Source code or "Download ZIP"** to install the app. Run the setup wizard; no Node, Python, database tools or scripting are
needed. Installation is per-user and does not require administrator privileges.
The app opens your default browser after setup.

Bookmark **http://127.0.0.1:38473**. The Start menu and desktop shortcuts also
open the app. It starts hidden at Windows sign-in, continues when the browser
is closed, and retries unexpected failures up to five times. It runs while
you are signed in, not while your PC is off, asleep or signed out. Windows
Startup Apps can disable its startup shortcut. Managed PCs may disable Windows
Script Host; check your organization's policy if shortcuts do not launch.

This initial build is unsigned. Windows SmartScreen may show "Windows protected
your PC"; if you downloaded it from the release page above, choose **More info →
Run anyway**. Do not ignore warnings for downloads from other sources. Public releases should be code-signed
with the publisher's certificate. Compare SHA-256 checksums with `SHA256SUMS.txt`
from the same release. A checksum alone does not establish publisher trust.

## Use

- Add a title, choose **Movie** or **TV show**, search and select the matching
  release. Available metadata fills in automatically. Ambiguous titles are
  never silently matched. Manual entry works offline.
- Search forgives typos: `godfathr`, `intersteller` or `brekin bad` still find
  the right title, with "Did you mean" suggestions and a one-click switch
  between movie and TV search. Adding a year (`dune 2021`) ranks that release
  first.
- Addition order is the default. Sort by title, release year, source rating,
  runtime, director, recently viewed, or newest addition. Filter all/viewed/
  unviewed, type and genre; search title, cast, directors, genres and notes.
- Mark viewed directly on a card. Open details for cast, concise summary,
  metadata source, IMDb link when known, trailer/search links and notes.
- Reports show completion, known movie backlog hours, genres, decades,
  collection growth, recent viewing and source ratings. Print to PDF.
- Export CSV, complete JSON, or a consistent SQLite snapshot. Credentials
  are excluded from every export.
- Customize the banner, subtitle, colors, layout and background image.
  The navigation retains the Movies of Interest identity.

## Metadata: honest limits

**No API key is required.** Movies use Wikidata facts with optional English
Wikipedia summaries and page images; TV uses TVmaze. Coverage varies. Images
may be article images rather than theatrical posters. Keyless movies generally
have no rating. Unknown facts stay unknown rather than being invented.

Streaming shortcuts cover Netflix, Hulu, Peacock, Prime Video, Disney+, Apple
TV, HBO Max and YouTube. These are **search links, not verified availability or
direct playback links**. A provider may redirect to its home page or require
you to search again after sign-in. YouTube Premium does not imply that a
Primetime movie or rental is free. Trailer shortcuts in keyless mode are
YouTube searches, not verified trailers.

Optionally enter your own **TMDB API Read Access Token** in Settings. This
enables richer searches, posters, source ratings, trailers, and region-specific
TMDB/JustWatch watch guides for new TMDB entries. Availability can change;
subscription, free, ads, rent and buy are labeled separately. Provider URLs
link to watch guides, not guaranteed playable titles. Default country is US.
Refresh TMDB entries to update availability or use a newly selected country.
Existing keyless entries retain their original source. To get TMDB metadata
for one, add its TMDB search match, copy notes, then remove the original if
desired. TMDB credentials are stored locally in plaintext; protect your data
folder. Network errors are reported; existing saved metadata stays intact.

## Data, stop, uninstall and restore

Data is stored at `%LOCALAPPDATA%\MoviesOfInterest\library.db`, separate from
the installed program. No telemetry, login or hosted backend is used. Title
searches go to the selected metadata provider; displayed remote artwork makes
requests to its image host (as does the remote attribution logo in Settings). Saved entries remain browsable offline, although
remote posters may not load.

**Stop server** is reversible: relaunch using the Start menu or sign in again.
**Uninstall** removes the program and sign-in shortcut. The interactive
uninstaller defaults to **keeping your data** and asks twice before permanent
database deletion. Silent uninstall always keeps data. Removal and deletion
are different actions; export first. You can also uninstall through Windows
Settings > Apps.

To restore an exported SQLite database:

1. Stop the app and confirm the bookmark no longer responds.
2. Back up the existing `%LOCALAPPDATA%\MoviesOfInterest` folder.
3. Replace only `library.db` with the exported `.db` file. Remove only
   `library.db-wal` and `library.db-shm` from that folder if present.
4. Relaunch from the Start menu. Re-enter an optional TMDB token if needed.

SQLite exports contain all user data and appearance preferences except the
TMDB token. CSV is spreadsheet-safe (formula-prefixed cells are escaped).
JSON is a portable data export; automated JSON/CSV import is not implemented.

## Develop and build

Contributor tools only: **Node 24 x64**, npm and **Inno Setup 6 or 7** on Windows.
Runtime dependencies: none (Node's built-in HTTP and SQLite).

```powershell
npm ci
npm test
npm start
npm run build
```

If Inno Setup is not in a standard installation location, set `ISCC_PATH` to
the full path of `ISCC.exe`. Build output is in `dist`. The bundled executable
embeds the UI, both logos and metadata adapter, with no external JS files.
The provided SONG Labs image is already included; contributors do not need
access to the original absolute path.

On an ARM64 development PC, place the official Node 24 Windows **x64**
`node.exe` at `.tools\node-x64.exe` with its matching `LICENSE` beside it.
The build automatically uses that runtime. The x64 installer also runs on
Windows 11 ARM64 through Windows' x64 emulation.

Developer overrides: `MOI_DATA_DIR` and `MOI_PORT`. Use a separate data folder
and port for tests. The executable accepts `--open` and `--stop`.

## Public GitHub distribution

Pushing a tag such as `v1.0.1` runs the **Windows installer** workflow, which
tests, builds and smoke-tests the app, then publishes a GitHub Release with the
installer and `SHA256SUMS.txt`. The workflow can also be run manually to
download a build artifact without releasing. Version values in the package,
app, installer, workflow and the README download link must be updated together
for each release. Consider signing both app and installer before broad release.

## Attribution and licensing

- Application source and the original Movies of Interest mark: **MIT**.
- SONG Labs name and supplied logo: separately owned, **not MIT licensed**.
  Obtain permission before reusing this branding outside the project.
- [Wikidata](https://www.wikidata.org/wiki/Wikidata:Licensing): **CC0** facts.
- [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Copyrights): summaries
  adapted under **CC BY-SA**; linked source pages provide provenance and image
  licensing. Images retain their individual copyrights.
- [TVmaze](https://www.tvmaze.com/api): **CC BY-SA** metadata. Each title links
  to its source. Preserve these attributions when redistributing exports.
- Optional [TMDB](https://www.themoviedb.org/): This product uses the TMDB API
  but is not endorsed or certified by TMDB. Optional streaming data is
  provided by [JustWatch](https://www.justwatch.com/) via TMDB.
- The bundled Node runtime contains third-party components. The build includes
  Node's license separately in
  the installer (see `NODE-LICENSE.txt` in the installed program folder).

Movie and TV images remain copyrighted to their respective owners. The
application does not download, distribute or play movie/TV media.
