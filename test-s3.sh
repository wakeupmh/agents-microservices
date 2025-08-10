#!/bin/bash

# Medical Agent S3 Testing Script
# This script uploads test lab data to S3 to trigger the medical agent

set -e

# Configuration
BUCKET_NAME="medical-agent-lab-results-dev"
AWS_REGION="us-east-1"
TEST_DATA_DIR="test_data"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Medical Agent S3 Testing${NC}"
echo "=================================="

# Check if AWS CLI is installed
if ! command -v aws >/dev/null 2>&1; then
    echo -e "${RED}❌ AWS CLI not installed${NC}"
    echo "Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo -e "${RED}❌ AWS CLI not configured${NC}"
    echo ""
    echo "Please configure AWS credentials using one of these methods:"
    echo "1. Run: aws configure"
    echo "2. Set environment variables:"
    echo "   export AWS_ACCESS_KEY_ID=your_access_key"
    echo "   export AWS_SECRET_ACCESS_KEY=your_secret_key"
    echo "   export AWS_REGION=us-east-1"
    echo "3. Use AWS Profile: export AWS_PROFILE=your_profile_name"
    echo ""
    exit 1
fi

# Check if bucket exists
if ! aws s3 ls "s3://${BUCKET_NAME}" >/dev/null 2>&1; then
    echo -e "${RED}❌ Bucket ${BUCKET_NAME} not found or not accessible${NC}"
    echo "Make sure to deploy the serverless application first: 'serverless deploy'"
    exit 1
fi

echo -e "${GREEN}✅ AWS credentials and bucket verified${NC}"

# Check if test data directory exists
if [ ! -d "$TEST_DATA_DIR" ]; then
    echo -e "${YELLOW}⚠️  Test data directory not found. Creating it...${NC}"
    mkdir -p "$TEST_DATA_DIR"
    
    echo -e "${BLUE}💡 Creating sample test data...${NC}"
    
    # Create normal glucose test file if it doesn't exist
    cat > "$TEST_DATA_DIR/normal_glucose.json" << 'EOF'
{
  "patient_id": "PAT001",
  "exam_date": "2024-08-08T10:30:00Z",
  "lab_results": {
    "glucose": {"value": 95, "unit": "mg/dL", "reference": "70-99"},
    "hba1c": {"value": 6.2, "unit": "%", "reference": "<7.0"},
    "cholesterol": {"value": 180, "unit": "mg/dL", "reference": "<200"}
  },
  "patient_info": {
    "age": 45,
    "gender": "M",
    "conditions": ["diabetes_type2"],
    "medications": ["metformina"]
  }
}
EOF
    
    # Create critical high glucose test file
    cat > "$TEST_DATA_DIR/critical_high_glucose.json" << 'EOF'
{
  "patient_id": "PAT003",
  "exam_date": "2024-08-08T16:45:00Z",
  "lab_results": {
    "glucose": {"value": 350, "unit": "mg/dL", "reference": "70-99"},
    "hba1c": {"value": 12.1, "unit": "%", "reference": "<7.0"},
    "ketones": {"value": 2.5, "unit": "mmol/L", "reference": "<0.6"}
  },
  "patient_info": {
    "age": 35,
    "gender": "M",
    "conditions": ["diabetes_type1"],
    "medications": ["insulina_lispro", "insulina_glargina"]
  }
}
EOF
    
    echo -e "${GREEN}✅ Sample test data created${NC}"
fi

# Function to upload test file
upload_test_file() {
    local file_name=$1
    local description=$2
    
    echo ""
    echo -e "${YELLOW}📤 Testing: $description${NC}"
    echo "File: $file_name"
    
    if [ ! -f "$TEST_DATA_DIR/$file_name" ]; then
        echo -e "${RED}❌ Test file not found: $TEST_DATA_DIR/$file_name${NC}"
        return 1
    fi
    
    # Upload to S3
    local s3_key="test_$(date +%Y%m%d_%H%M%S)_$file_name"
    
    echo "Uploading to s3://${BUCKET_NAME}/${s3_key}..."
    
    if aws s3 cp "$TEST_DATA_DIR/$file_name" "s3://${BUCKET_NAME}/${s3_key}"; then
        echo -e "${GREEN}✅ File uploaded successfully${NC}"
        echo "S3 Object: s3://${BUCKET_NAME}/${s3_key}"
        
        # Wait a bit for processing
        echo "⏳ Waiting for medical agent to process..."
        sleep 5
        
        # Show CloudWatch logs (optional)
        echo -e "${BLUE}💡 To check logs:${NC}"
        echo "aws logs tail /aws/lambda/medical-strands-agent-dev-medicalAgent --follow"
        
    else
        echo -e "${RED}❌ Failed to upload file${NC}"
        return 1
    fi
}

# Main testing function
run_tests() {
    echo ""
    echo "🧪 Running test scenarios..."
    
    # Test 1: Normal glucose levels
    upload_test_file "normal_glucose.json" "Normal glucose levels (should be routine)"
    
    # Wait between tests
    sleep 3
    
    # Test 2: High glucose (non-critical)
    upload_test_file "high_glucose.json" "High glucose levels (should trigger priority)"
    
    # Wait between tests
    sleep 3
    
    # Test 3: Critical high glucose
    upload_test_file "critical_high_glucose.json" "CRITICAL high glucose (should trigger emergency)"
    
    # Wait between tests
    sleep 3
    
    # Test 4: Critical low glucose
    upload_test_file "critical_low_glucose.json" "CRITICAL low glucose (should trigger emergency)"
}

# Function to show logs
show_logs() {
    echo ""
    echo -e "${BLUE}📊 Recent CloudWatch Logs:${NC}"
    echo "=================================="
    
    # Get recent logs from medical agent
    aws logs tail /aws/lambda/medical-strands-agent-dev-medicalAgent \
        --since 5m \
        --format short \
        --follow=false \
        2>/dev/null || echo "No recent logs found"
    
    echo ""
    echo -e "${BLUE}📅 Appointment Handler Logs:${NC}"
    echo "=================================="
    
    # Get recent logs from appointment handler
    aws logs tail /aws/lambda/medical-strands-agent-dev-createAppointment \
        --since 5m \
        --format short \
        --follow=false \
        2>/dev/null || echo "No recent logs found"
}

# Function to clean up test files
cleanup_test_files() {
    echo ""
    echo -e "${YELLOW}🧹 Cleaning up test files from S3...${NC}"
    
    # List and delete test files
    aws s3 ls "s3://${BUCKET_NAME}/" | grep "test_" | awk '{print $4}' | while read -r file; do
        if [ ! -z "$file" ]; then
            echo "Deleting: $file"
            aws s3 rm "s3://${BUCKET_NAME}/$file"
        fi
    done
    
    echo -e "${GREEN}✅ Cleanup completed${NC}"
}

# Check command line arguments
case "${1:-}" in
    "normal")
        upload_test_file "normal_glucose.json" "Normal glucose levels test"
        ;;
    "high")
        upload_test_file "high_glucose.json" "High glucose levels test"
        ;;
    "critical-high")
        upload_test_file "critical_high_glucose.json" "Critical high glucose test"
        ;;
    "critical-low")
        upload_test_file "critical_low_glucose.json" "Critical low glucose test"
        ;;
    "logs")
        show_logs
        ;;
    "cleanup")
        cleanup_test_files
        ;;
    "all"|"")
        run_tests
        echo ""
        echo -e "${BLUE}💡 Test completed! Use './test_s3.sh logs' to see results${NC}"
        ;;
    *)
        echo "Usage: $0 [normal|high|critical-high|critical-low|all|logs|cleanup]"
        echo ""
        echo "Commands:"
        echo "  normal       - Test normal glucose levels"
        echo "  high         - Test high glucose levels"
        echo "  critical-high - Test critical high glucose"
        echo "  critical-low  - Test critical low glucose"
        echo "  all          - Run all tests (default)"
        echo "  logs         - Show recent CloudWatch logs"
        echo "  cleanup      - Remove test files from S3"
        echo ""
        echo "Examples:"
        echo "  ./test_s3.sh                    # Run all tests"
        echo "  ./test_s3.sh critical-high      # Test critical case"
        echo "  ./test_s3.sh logs               # Check results"
        echo "  ./test_s3.sh cleanup            # Clean up"
        exit 1
        ;;
esac