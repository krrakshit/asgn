
echo "Starting 10 client instances..."

# Start top clients in background
for i in {1..5}; do
    echo "Starting top-client-$i"
    node ../client/index.js top "top-client-$i" &
    sleep 1
done

# Start bottom clients in background
for i in {1..5}; do
    echo "Starting bottom-client-$i"
    node ../client/index.js bottom "bottom-client-$i" &
    sleep 1
done

echo "All clients started!"
echo "Press Ctrl+C to stop all clients"

# Wait for all background processes
wait