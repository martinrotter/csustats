# Third-party notices

CsuStats source code is licensed under the MIT license in [LICENSE](LICENSE).
The following third-party components retain their own licenses and copyrights.
All corresponding license and notice texts are embedded into the generated HTML.

| Component                                                         | Version                        | License      | Local notices                                                                      |
| ----------------------------------------------------------------- | ------------------------------ | ------------ | ---------------------------------------------------------------------------------- |
| [Papa Parse](https://github.com/mholt/PapaParse)                  | 5.5.3                          | MIT          | [LICENSE](vendor/papaparse/LICENSE)                                                |
| [Tabulator](https://github.com/olifolkerd/tabulator)              | 6.3.1                          | MIT          | [LICENSE](vendor/tabulator/LICENSE)                                                |
| [Apache ECharts](https://github.com/apache/echarts)               | 6.0.0                          | Apache-2.0   | [LICENSE](vendor/echarts/LICENSE), [NOTICE](vendor/echarts/NOTICE)                 |
| d3 portions included in ECharts                                   | distributed with ECharts 6.0.0 | BSD-3-Clause | [LICENSE-d3](vendor/echarts/LICENSE-d3)                                            |
| [ZRender](https://github.com/ecomfe/zrender), included in ECharts | 6.0.0                          | BSD-3-Clause | [LICENSE](vendor/zrender/LICENSE)                                                  |
| [tslib](https://github.com/microsoft/tslib), included in ECharts  | 2.3.0                          | 0BSD         | [LICENSE](vendor/tslib/LICENSE.txt), [copyright](vendor/tslib/CopyrightNotice.txt) |

Exact upstream URLs and SHA-256 digests are recorded in [vendor/manifest.json](vendor/manifest.json).
Vendor files are preserved byte for byte. Development tools esbuild and Prettier
are version-locked in `package-lock.json` and do not run in the published site.

Statistical data and the geographic catalog originate from the Czech Statistical
Office (ČSÚ). The application license does not relicense those datasets.
See [data provenance](documentation/data.md) and the original ČSÚ documentation.
