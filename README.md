# Kids First Snapshot Task Service
Snapshot Task Service is a standalone application running against Kids First Release Coordinator.  
Following the [Task Service Specfications][1], the service saves data dumps for releases to AWS S3.

## Getting Started (TBD)

## Operations
On a release, this service requests all entity endpoints for all studies included in the release.
Only entities with `visible=True` will be stored in a snapshot.
It tars JSONs from the Data Service endpoints and uploads to S3 in the following folder structure:
```
RE_00000001
    └── SD_00000001
        └── dataservice
                └── SD.json
                └── PT.json
                └── DG.json
                └── PH.json
                └── ...
        └── elasticsearch
               └── participant_centric_SD_00000001_RE_00000001.tar.gz
               └── file_centric_SD_00000001_RE_00000001.tar.gz
        └── ...
    └── SD_00000002
        └── ...
    └── RE_00000001.tar.gz  <- Everything above, tarred+compressed
└── ...
```

[1]: https://github.com/kids-first/kf-api-release-coordinator
