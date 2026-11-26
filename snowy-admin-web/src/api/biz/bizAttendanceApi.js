import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/attendance/' + url, ...arg)

export default {
	sessionPage(data) {
		return request('session/page', data, 'get')
	},
	sessionAdd(data) {
		return request('session/add', data)
	},
	sessionBatchCreate(data) {
		return request('session/batchCreate', data)
	},
	sessionEnd(data) {
		return request('session/end', data)
	},
	sessionBatchEnd(data) {
		return request('session/batchEnd', data)
	},
	sessionDelete(data) {
		return request('session/delete', data)
	},
	sessionDetail(data) {
		return request('session/detail', data, 'get')
	},
	sessionQrState(data) {
		return request('session/qrState', data, 'get')
	},
	sessionRotateQr(data) {
		return request('session/rotateQr', data)
	},
	sessionUpdateConfig(data) {
		return request('session/updateConfig', data)
	},
	sessionRoster(data) {
		return request('session/roster', data, 'get')
	},
	sessionRosterStatus(data) {
		return request('session/rosterStatus', data)
	},
	dailyPage(data) {
		return request('daily/page', data, 'get')
	},
	dailyBatchUpsert(data) {
		return request('daily/batchUpsert', data)
	},
	dailyDelete(data) {
		return request('daily/delete', data)
	}
}
