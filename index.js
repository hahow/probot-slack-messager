const get = require('lodash/get')
const findIndex = require('lodash/findIndex')
const SlackBot = require('slackbots')

// TODO: env 處理 name
const reportChannelName = process.env.REPORT_CHANNEl

const bot = new SlackBot({
  // TODO: env 處理 token
  token: process.env.SLACK_BOT_TOKEN,
  name: process.env.SLACK_BOT_NAME || 'bugbuster'
})

let contact = []
let reportChannelId
let github

_getSlackUsers().then((contacts) => {
  contact = contacts
})

_getSlackChannel(reportChannelName).then((channel) => {
  reportChannelId = channel.id
})

// 主要有兩個大功能

// 1. probot 聽 github 的事件
module.exports = robot => {
  robot.on('*', async context => {
    // dirty workaround
    if (!github) {
      github = { ...context.github }
    }
  })
  _onIssueAssigned(robot)
  _onIssueClosed(robot)
  _slackBot(robot)
}

function _slackBot (robot) {
  // 2. SlackBot 聽某一頻道 zenhub 移動的事件
  bot.on('message', (data) => {
    // all ingoing events https://api.slack.com/rtm
    if (data.type === 'message' && data.subtype === 'bot_message') {
      if (data.text.includes('moved issue') && github) {
        _onMoveIssue(data)
      }
    }
  })
}

function _onMoveIssue (data) {
  const issue = _parseIssue(data.text)
  const pipline = _parsePipline(data.attachments[0].text)

  github.issues.get({
    ...issue
  }).then((res) => {
    const issueTitle = res.data.title
    const issueNumber = res.data.number
    const issueAssignees = res.data.assignees
    const issueBody = res.data.body
    const issueUrl = res.data.url

    // fond slack user in issue body
    const parseSlackUsername = _findSlackUsername(issueBody)
    if (parseSlackUsername.length < 1) return
    const slackIds = _transferUsernameToId(parseSlackUsername)
    const assigneesActtachments = issueAssignees.map((issueAssignee) => {
      return {
        title: issueAssignee.login,
        image_url: issueAssignees.avatar_url,
        thumb_url: issueAssignees.avatar_url,
        color: '#00bea4'
      }
    })

    const text = `${_appendMention(slackIds)}#${issueNumber} ${issueTitle} 這個 issue 被移到 ${pipline}`
    const attachments = [].concat(
      {
        title: text,
        title_link: issueUrl,
        color: '#fa8b00'
      },
      assigneesActtachments
    )

    bot.postMessage(reportChannelId,
      text,
      {
        attachments
      }
    )
  })
}

function _parsePipline (body) {
  const regax = /\*[a-z\sA-Z/]*\*/gm
  const matches = body.match(regax)
  return matches[matches.length - 1]
}

function _parseIssue (body) {
  const regex1 = /<(.*)\|/
  const regex2 = /https:\/\/github.com\/(.*)\/(.*)\/issues\/(.*)/
  const issueUrl = body.match(regex1)[1]
  const issuesMeta = issueUrl.match(regex2)
  return {
    owner: issuesMeta[1],
    repo: issuesMeta[2],
    number: issuesMeta[3]
  }
}

function _onIssueClosed (robot) {
  robot.on('issues.closed', async context => {
    const issueUrl = get(context, 'payload.issue.url')
    const issueBody = get(context, 'payload.issue.body')
    const issueNumber = get(context, 'payload.issue.number')
    const issueTitle = get(context, 'payload.issue.title')
    const issueAssignees = get(context, 'payload.issue.assignees')
    const issueLabels = get(context, 'payload.issue.labels')

    // fond slack user in issue body
    const parseSlackUsername = _findSlackUsername(issueBody)
    if (parseSlackUsername.length < 1) return

    const slackIds = _transferUsernameToId(parseSlackUsername)

    const isWontFix = findIndex(issueLabels, {
      name: 'wontfix'
    }) !== -1

    console.log(isWontFix)

    let assignees = ''
    issueAssignees.forEach((issueAssignee, index) => {
      assignees += `${index === 0 ? '' : ', '}${issueAssignee.login}`
    })

    const assigneesActtachments = issueAssignees.map((issueAssignee) => {
      return {
        title: issueAssignee.login,
        image_url: issueAssignees.avatar_url,
        thumb_url: issueAssignees.avatar_url,
        color: '#00bea4'
      }
    })
    let text
    if (isWontFix) {
      text = `${_appendMention(slackIds)}#${issueNumber} ${issueTitle} 這個 issue 已經被 『關閉了』，想了解更多請詢問 ${assignees}。`
    } else {
      text = `${_appendMention(slackIds)}#${issueNumber} ${issueTitle} 這個 issue 已經被 ${assignees} 修復了，等待上線後，這個問題就不見囉。`
    }

    const attachments = [].concat(
      {
        title: `#${issueNumber} ${issueTitle}: ${issueUrl}`,
        title_link: issueUrl,
        color: '#fa8b00'
      },
      assigneesActtachments
    )

    bot.postMessage(reportChannelId,
      text,
      {
        attachments
      }
    )
  })
}

function _onIssueAssigned (robot) {
  robot.on('issues.assigned', async context => {
    const issueUrl = get(context, 'payload.issue.url')
    const issueBody = get(context, 'payload.issue.body')
    const issueNumber = get(context, 'payload.issue.number')
    const issueTitle = get(context, 'payload.issue.title')
    const issueAssignees = get(context, 'payload.issue.assignees')

    // fond slack user in issue body
    const parseSlackUsername = _findSlackUsername(issueBody)
    if (parseSlackUsername.length < 1) return

    const slackIds = _transferUsernameToId(parseSlackUsername)

    let assignees = ''
    issueAssignees.forEach((issueAssignee, index) => {
      assignees += `${index === 0 ? '' : ', '}${issueAssignee.login}`
    })

    const assigneesActtachments = issueAssignees.map((issueAssignee) => {
      return {
        title: issueAssignee.login,
        image_url: issueAssignees.avatar_url,
        thumb_url: issueAssignees.avatar_url,
        color: '#00bea4'
      }
    })

    const text = `${_appendMention(slackIds)}#${issueNumber} ${issueTitle} 這個 issue 被指派給 ${assignees}，想了解後續進度就去找他（們）。`
    const attachments = [].concat(
      {
        title: `#${issueNumber} ${issueTitle}: ${issueUrl}`,
        title_link: issueUrl,
        color: '#fa8b00'
      },
      assigneesActtachments
    )

    bot.postMessage(reportChannelId,
      text,
      {
        attachments
      }
    )
  })
}

function _appendMention (ids) {
  const slackNotifyPrefix = '<@'
  const slackNotifyPostfix = '>'

  return ids.map((id) => {
    return `${slackNotifyPrefix}${id}${slackNotifyPostfix}`
  }).join(' ')
}

function _transferUsernameToId (names = []) {
  let result = []
  names.map((name) => {
    return contact.filter((member) => {
      return member.names.includes(name)
    }).map((member) => {
      return member.id
    }).forEach((memberIds) => {
      result = result.concat(memberIds)
    })
  })
  return result
}

function _findSlackUsername (body) {
  let usernames = []
  const regex1 = /<slack([a-zA-z\s1-9]*)>([a-zA-z\s0-9,]*)<\/slack>/gm
  const regex2 = /<slack([a-zA-z\s1-9]*)>([a-zA-z\s0-9,]*)<\/slack>/

  const matches = body.match(regex1) || []

  if (matches.length > 0) {
    matches.forEach((match) => {
      usernames = usernames.concat(match.match(regex2)[2].split(', '))
    })
  }
  return usernames
}

function _getSlackUsers () {
  return bot.getUsers().then((res) => {
    return res.members.filter((member) => {
      return !member.is_bot && member.deleted === false
    }).map((member) => {
      const names = []
      if (member.name) {
        names.push(member.name)
      }

      if (get(member, 'profile.real_name')) {
        names.push(get(member, 'profile.real_name'))
      }

      if (get(member, 'profile.display_name')) {
        names.push(get(member, 'profile.display_name'))
      }

      return {
        id: member.id,
        names
      }
    })
  })
}

function _getSlackChannel (name) {
  return bot.getChannel(name)
}
