#!/bin/sh
HOST=nc1
DIR=/docker/uno/   # the directory where your website files should go
#rsync -avz --delete public/ ${HOST}:${DIR}
rsync -avz  ./ ${HOST}:${DIR}
#exit 0#