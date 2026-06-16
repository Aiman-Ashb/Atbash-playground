#!/usr/bin/env bash

# Mock Hermes Agent Script
# Simulates the interactive prompt behaviour of Hermes CLI for testing.

QUERY=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -q|--query) QUERY="$2"; shift ;;
        *) ;;
    esac
    shift
done



if [[ "$QUERY" == *"whoami"* || "$QUERY" == *"command"* ]]; then
    # Simulate dangerous command warning
    echo "  ⚠️  DANGEROUS COMMAND: execute shell command on the host"
    echo "      whoami"
    echo ""
    echo "      [o]nce  |  [s]ession  |  [a]lways  |  [d]eny"
    echo ""
    echo -n "      Choice [o/s/a/D]: "
    
    # Read user choice from stdin
    read -r CHOICE
    
    if [[ "$CHOICE" == "o" || "$CHOICE" == "once" || "$CHOICE" == "s" || "$CHOICE" == "session" || "$CHOICE" == "a" || "$CHOICE" == "always" ]]; then
        echo "      ✓ Allowed once"
        echo ""
        echo "╭─ ⚕ Hermes ───────────────────────────────────────────────────────────────────╮"
        echo "    Mock command executed successfully: aimanmengesha"
        echo "╰──────────────────────────────────────────────────────────────────────────────╯"
    else
        echo "      ✗ Denied"
    fi
    # Simple reply
    echo "Running tool read_file..."
    sleep 1
    echo "Running tool search_web..."
    sleep 1
    echo "╭─ ⚕ Hermes ───────────────────────────────────────────────────────────────────╮"
    echo "    Hello! I am mock Hermes. I received your message: \"$QUERY\""
    echo "╰──────────────────────────────────────────────────────────────────────────────╯"
else
    # Default reply for normal messages
    echo "Running tool read_file..."
    sleep 1
    echo "╭─ ⚕ Hermes ───────────────────────────────────────────────────────────────────╮"
    echo "    Hello! I am mock Hermes. I received your message: \"$QUERY\". How can I help you?"
    echo "╰──────────────────────────────────────────────────────────────────────────────╯"
fi
