#!/usr/bin/env python3
"""
Chat App Startup Script
This script starts your real-time chat application with public internet access.
"""

import os
import sys
import time
from pyngrok import ngrok

def main():
    print("🚀 Starting Real-time Chat Application...")
    print("=" * 50)
    
    # Check if required packages are installed
    try:
        import flask
        import flask_socketio
        import eventlet
    except ImportError as e:
        print(f"❌ Missing required package: {e}")
        print("💡 Run: pip install flask flask-socketio eventlet")
        return
    
    # Start ngrok tunnel
    print("🌐 Setting up public internet access...")
    try:
        # Kill any existing ngrok processes
        ngrok.kill()
        time.sleep(1)
        
        # Create HTTP tunnel
        public_url = ngrok.connect(5000)
        print(f"✅ Public URL created successfully!")
        print(f"🔗 Share this link with your friends:")
        print(f"   {public_url}")
        print(f"📊 ngrok dashboard: http://localhost:4040")
        
    except Exception as e:
        print(f"⚠️  ngrok error: {e}")
        print("📱 Starting without public URL (only local network access)")
        print("💡 You can still share with friends on the same WiFi network")
    
    print("\n" + "=" * 50)
    print("🚀 Starting Flask server...")
    print("💡 Press Ctrl+C to stop the server")
    print("=" * 50)
    
    # Start the Flask app
    os.system("python app.py")

if __name__ == "__main__":
    main() 