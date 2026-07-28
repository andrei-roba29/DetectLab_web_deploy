
        async function register(username, email, password) {

            const res = await fetch("http://localhost:3000/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    email,
                    password
                })
            });

            const data = await res.json();

            console.log(data);

            if (data.success) {

                alert("REGISTER SUCCESS");

            } else {

                alert(data.error);

            }
        }



        async function login(email, password) {

            const res = await fetch("http://localhost:3000/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email,
                    password
                })
            });

            const data = await res.json();

            console.log(data);

            if (data.success) {

                localStorage.setItem("token", data.token);

                alert("LOGIN SUCCESS");

            } else {

                alert(data.error);

            }
        }

