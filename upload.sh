#!/bin/bash

# FTP Configuration
FTP_HOST="ftp.evaturkey.com"
FTP_USER="darkhorizon@evaturkey.com"
FTP_PORT="21"

# Prompt for FTP Password securely
read -s -p "Enter FTP Password for $FTP_USER@$FTP_HOST: " FTP_PASS
echo

# Local and Remote Directories
# Vite builds to 'dist' by default. 
LOCAL_DIR="./dist"
REMOTE_DIR="/public_html/icefrog"

echo "Starting deployment..."
echo "Local Directory:  $LOCAL_DIR"
echo "Remote Directory: $REMOTE_DIR"

# Check if dist exists
if [ ! -d "$LOCAL_DIR" ]; then
    echo "Error: Directory $LOCAL_DIR does not exist. Did you run 'npm run build'?"
    exit 1
fi

# Check if lftp is installed
if ! command -v lftp &> /dev/null
then
    echo "Error: lftp is not installed. Please install it (e.g., sudo apt install lftp, sudo pacman -S lftp, etc.)."
    exit 1
fi

# Upload using lftp
# mirror -R: Reverse mirror (upload local to remote)
# --verbose: Show processed files
# --parallel=10: Upload up to 10 files in parallel
echo "Connecting to FTP..."

lftp -p "$FTP_PORT" -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" <<EOF
set ssl:verify-certificate no
mirror -R --verbose --parallel=10 "$LOCAL_DIR/" "$REMOTE_DIR"
bye
EOF

echo "Deployment finished."
