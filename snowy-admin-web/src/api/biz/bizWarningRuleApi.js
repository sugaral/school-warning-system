import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/warningrule/' + url, ...arg)

export default {
	rulePage(data) {
		return request('page', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	ruleDelete(data) {
		return request('delete', data)
	},
	ruleDetail(data) {
		return request('detail', data, 'get')
	},
	orgTreeSelector(data) {
		return request('orgTreeSelector', data, 'get')
	}
}
