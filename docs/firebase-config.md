```TS
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
apiKey: "AIzaSyDw6gEB35kN91drrtVXJ8jjytroccAUkyU",
authDomain: "web-push-f72d9.firebaseapp.com",
projectId: "web-push-f72d9",
storageBucket: "web-push-f72d9.firebasestorage.app",
messagingSenderId: "1060896211183",
appId: "1:1060896211183:web:aa547b2d2a47b727dddb1a",
measurementId: "G-W5HXFWJV8R"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
```
