# Error messages and exit statuses
noexiste_cmd; echo "status=$?"
cd /no/existe; echo "status=$?"
echo $((1/0)); echo "tras div"
