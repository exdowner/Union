{
  "rules": {
    "users": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid",
        "photoBase64": {
          ".validate": "newData.isString() && newData.val().length <= 280000"
        },
        "$field": {
          ".validate": "newData.isString() == false || newData.val().length <= 5000"
        }
      }
    },

    "presence": {
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "friends": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        "$friendUid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.hasChildren(['status']) && newData.child('status').val() in ['friend','blocked','request_sent','request_in','blocked_by']"
        }
      }
    },

    "servers": {
      ".read": "auth != null",
      "$serverId": {
        ".write": "auth != null && (!data.exists() || data.child('ownerId').val() === auth.uid)",
        "iconBase64": {
          ".validate": "newData.isString() && newData.val().length <= 280000"
        }
      }
    },

    "serverMembers": {
      "$serverId": {
        ".read": "auth != null",
        "$uid": {
          ".write": "auth != null && (auth.uid === $uid || root.child('servers').child($serverId).child('ownerId').val() === auth.uid)"
        }
      }
    },

    "userServers": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "channels": {
      "$serverId": {
        ".read": "auth != null",
        "$channelId": {
          ".write": "auth != null && (root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())",
          ".validate": "newData.hasChildren(['name','type','createdAt'])"
        }
      }
    },

    "channelMeta": {
      "$serverId": {
        ".read": "auth != null",
        "$channelId": {
          ".write": "auth != null && (root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())"
        }
      }
    },

    "messages": {
      "$serverId": {
        "$channelId": {
          ".read": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists()",
          "$msgId": {
            ".write": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists() && ((!data.exists() && newData.hasChild('uid') && newData.child('uid').val() === auth.uid) || (data.hasChild('uid') && data.child('uid').val() === auth.uid) || root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())",
            ".validate": "(!newData.hasChild('imageBase64')) || (newData.child('imageBase64').isString() && newData.child('imageBase64').val().length <= 280000 && newData.child('contentType').isString() && newData.child('contentType').val().matches('^image/'))",
            "reactions": {
              "$emoji": {
                "$uid": {
                  ".write": "auth != null && auth.uid === $uid",
                  ".validate": "newData.val() === true"
                }
              }
            }
          }
        }
      }
    },

    "posts": {
      "$serverId": {
        "$channelId": {
          ".read": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists()",
          "$postId": {
            ".write": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists() && ((!data.exists() && newData.hasChild('uid') && newData.child('uid').val() === auth.uid) || (data.hasChild('uid') && data.child('uid').val() === auth.uid) || root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())"
          }
        }
      }
    },

    "replies": {
      "$serverId": {
        "$channelId": {
          "$postId": {
            ".read": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists()",
            "$replyId": {
              ".write": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists() && ((!data.exists() && newData.hasChild('uid') && newData.child('uid').val() === auth.uid) || (data.hasChild('uid') && data.child('uid').val() === auth.uid) || root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())"
            }
          }
        }
      }
    },

    "pins": {
      "$serverId": {
        "$channelId": {
          "$msgId": {
            ".read": "auth != null",
            ".write": "auth != null && (root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())"
          }
        }
      }
    },

    "saved": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "gifFavs": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "stickerFavs": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "emojiFavs": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "reads": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "typing": {
      "dms": {
        "$pairKey": {
          "$uid": {
            ".read": "auth != null && root.child('dmsMembers').child($pairKey).child(auth.uid).exists()",
            ".write": "auth != null && auth.uid === $uid"
          }
        }
      },
      "$serverId": {
        "$channelId": {
          "$uid": {
            ".read": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists()",
            ".write": "auth != null && auth.uid === $uid"
          }
        }
      }
    },

    "stickers": {
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "voicePresence": {
      "$serverId": {
        "$channelId": {
          ".read": "auth != null",
          "$uid": {
            ".write": "auth != null && auth.uid === $uid"
          }
        }
      }
    },

    "calls": {
      ".read": "auth != null",
      ".write": "auth != null"
    },

    "callChats": {
      "$callKey": {
        ".read": "auth != null",
        "$msgId": {
          ".write": "auth != null && newData.hasChild('uid') && newData.child('uid').val() === auth.uid"
        }
      }
    },

    "dmsMembers": {
      "$pairKey": {
        "$uid": {
          ".read": "auth != null && root.child('dmsMembers').child($pairKey).child(auth.uid).exists()",
          ".write": "auth != null && auth.uid === $uid"
        }
      }
    },

    "dms": {
      "$pairKey": {
        ".read": "auth != null && root.child('dmsMembers').child($pairKey).child(auth.uid).exists()",
        ".write": "auth != null && root.child('dmsMembers').child($pairKey).child(auth.uid).exists()",
        "messages": {
          "$msgId": {
            ".write": "auth != null && root.child('dmsMembers').child($pairKey).child(auth.uid).exists() && ((!data.exists() && newData.hasChild('uid') && newData.child('uid').val() === auth.uid) || (data.hasChild('uid') && data.child('uid').val() === auth.uid))",
            ".validate": "(!newData.hasChild('imageBase64')) || (newData.child('imageBase64').isString() && newData.child('imageBase64').val().length <= 280000 && newData.child('contentType').isString() && newData.child('contentType').val().matches('^image/'))",
            "reactions": {
              "$emoji": {
                "$uid": {
                  ".write": "auth != null && auth.uid === $uid",
                  ".validate": "newData.val() === true"
                }
              }
            }
          }
        }
      }
    },

    "dmsMeta": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "notifications": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },

    "serverBans": {
      "$serverId": {
        "$uid": {
          ".read": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists()",
          ".write": "auth != null && (root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())"
        }
      }
    },

    "serverMutes": {
      "$serverId": {
        "$uid": {
          ".read": "auth != null && root.child('serverMembers').child($serverId).child(auth.uid).exists()",
          ".write": "auth != null && (root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())"
        }
      }
    },

    "reports": {
      "$reportId": {
        ".write": "auth != null",
        ".validate": "newData.hasChildren(['type', 'reporterUid', 'targetId', 'timestamp']) && newData.child('reporterUid').val() === auth.uid"
      }
    },

    "modLogs": {
      "$serverId": {
        ".read": "auth != null && (root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())",
        "$logId": {
          ".write": "auth != null && (root.child('servers').child($serverId).child('ownerId').val() === auth.uid || root.child('serverMembers').child($serverId).child(auth.uid).child('roles').child('admin').exists())"
        }
      }
    }
  }
}