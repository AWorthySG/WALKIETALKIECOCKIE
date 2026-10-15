Based on flutter_background 1.3.1 (MIT). Notification channel uses IMPORTANCE_LOW, no sound or vibration; foreground notification uses setSilent(true) and setOnlyAlertOnce(true). No other behaviour is changed.
The service uses START_NOT_STICKY: process death cannot reconstruct a private LiveKit session, so it must not restart an orphaned listening notification.
