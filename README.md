# Kids First Snapshot Task Service
Snapshot Task Service is a standalone application running against Kids First Release Coordinator.  
Following the [Task Service Specfications][1], the service saves data dumps for releases to AWS S3.

## Getting Started (TBD)

## Operations
On a release, this service requests all entity endpoints for all studies included in the release.   
It tars JSONs from the Data Service endpoints and uploads to S3 in the following folder structure:
```
RE_00000001
└── SD_00000001 
    └── SD.json
    └── PT.json
    └── DG.json
    └── PH.json
    └── ...
└── SD_00000002
    └── ...
└── ...
```

[1]: https://github.com/kids-first/kf-api-release-coordinator