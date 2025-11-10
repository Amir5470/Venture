import { onValueWritten } from "firebase-functions/database"
import admin from "firebase-admin"
admin.initializeApp()

export const sendNotif = onValueWritten("/messages/{id}", async (change, context) => {
    const payload = {
        notification: {
            title: "New Message",
            body: "Someone texted you!",
        },
    }

    const tokens = [
        // Put user tokens here (from frontend getToken)
    ]

    if (tokens.length > 0) {
        await admin.messaging().sendToDevice(tokens, payload)
    }
})
