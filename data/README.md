# Benchmark data

`benchmark.json` holds the numbers shown on the Benchmark page. They were measured on one
laptop and are not guarantees (see the notes in the file and on the page).

The file is checked against a schema (`src/features/benchmark/schema.ts`) by
`npm run check:benchmark`, which is part of `npm run verify`, and again when the page loads.
A figure that was not recorded is `null` and is shown as "not recorded"; nothing is estimated.

## Updating it

1. In the ledgerd repository, with the stack running, measure at the commit you want to publish:

   ```bash
   make up
   VUS=40 DURATION=20s make bench      # writes bench/results/summary.json and environment.txt
   ```

2. Here, import each run. `--vus` and `--seconds` are the `VUS` and `DURATION` of that run (k6's
   summary does not record them; the importer checks `--vus` against what k6 prepared):

   ```bash
   npm run import:k6 -- \
     --summary ../ledgerd/bench/results/summary.json \
     --environment ../ledgerd/bench/results/environment.txt \
     --vus 40 --seconds 20 --k6 2.3.0
   ```

   Run it once for each number of virtual users (10, 20, 40...). Rows measured under the same
   commit, machine and duration are merged; a row for the same scenario and virtual users
   replaces the old one. Rows from other conditions are refused, because they cannot sit side by
   side: add `--fresh` to start a new file instead (the old rows and notes are dropped).

3. Review `git diff data/benchmark.json`, add notes if the numbers need explaining, and run
   `npm run verify`.
