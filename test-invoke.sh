#!/bin/bash

# Test S3 invoke local script for medical agent
# Simulates an S3 event triggering the medical analysis function

# Default values
BUCKET_NAME="medical-agent-lab-results-dev"
OBJECT_KEY="test_20250809_220719_high_glucose.json"
FUNCTION_NAME="medicalAnalysis"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--bucket)
            BUCKET_NAME="$2"
            shift 2
            ;;
        -k|--key)
            OBJECT_KEY="$2"
            shift 2
            ;;
        -f|--function)
            FUNCTION_NAME="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  -b, --bucket    S3 bucket name (default: medical-strands-agent-lab-results-dev)"
            echo "  -k, --key       S3 object key (default: test-result.json)"
            echo "  -f, --function  Function name (default: medicalAgent)"
            echo "  -h, --help      Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            exit 1
            ;;
    esac
done

# Create the S3 event payload
EVENT_PAYLOAD=$(cat <<EOF
{
  "version": "0",
  "id": "test-event-id",
  "detail-type": "Object Created",
  "source": "aws.s3",
  "account": "123456789012",
  "time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "region": "us-east-1",
  "detail": {
    "version": "0",
    "bucket": {
      "name": "$BUCKET_NAME"
    },
    "object": {
      "key": "$OBJECT_KEY",
      "size": 1024,
      "etag": "test-etag",
      "sequencer": "test-sequencer"
    },
    "request-id": "test-request-id",
    "requester": "test-requester"
  }
}
EOF
)

echo "Invoking function: $FUNCTION_NAME"
echo "S3 Bucket: $BUCKET_NAME"
echo "S3 Object Key: $OBJECT_KEY"
echo "Event payload:"
echo "$EVENT_PAYLOAD" | jq .

echo ""
echo "Running serverless invoke local..."

# Run the serverless invoke local command
sls invoke local \
    --function "$FUNCTION_NAME" \
    --data "$EVENT_PAYLOAD"