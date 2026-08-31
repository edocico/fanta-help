# drizzle

Generated migrations land here from T3 onwards.

The directory ships as an `extraResources` entry so that in a packaged app it
sits **next to** `app.asar` instead of inside it: Drizzle reads the migration
folder from disk, and a relative path resolved inside the archive fails on
`meta/_journal.json`. The migration runner must use an absolute path built from
`process.resourcesPath`.

This file also keeps the directory non-empty, which is what makes the
`extraResources` copy verifiable before there are real migrations.
